/* NEXUS Native Bridge — phone hardware access
   This file detects if running inside the Android app (Capacitor)
   and enables native features: camera OCR, voice, barcode, notifications.
   When running as a PWA, it gracefully falls back to web APIs.
*/
(function(){
  const isNative = window.Capacitor !== undefined;
  
  // ═══ RECEIPT / DOCUMENT SCANNER ═══
  // Camera → photo → on-device OCR → extract vendor, amount, date → create node
  // Routes through NX.filePicker so user chooses camera / library / files
  NX.scanReceipt = async function() {
    // Use universal file picker — shows 3-option popup
    if (!NX.filePicker) {
      console.warn('[scanReceipt] file picker not loaded, falling back');
      return legacyScanReceipt();
    }
    
    const files = await NX.filePicker.pick({
      accept: 'image/*,application/pdf',
      multiple: false,
      title: 'Scan document'
    });
    if (!files || !files.length) return null;
    
    const file = files[0];
    const base64 = await fileToBase64(file);
    return await ocrViaClaudeVision(base64, file.type);
  };
  
  // Legacy fallback if picker not loaded (shouldn't happen)
  async function legacyScanReceipt() {
    // Try native Capacitor camera first
    if (isNative && window.Capacitor?.Plugins?.Camera) {
      try {
        const Camera = window.Capacitor.Plugins.Camera;
        const photo = await Camera.getPhoto({
          quality: 85,
          resultType: 'base64',
          source: 'CAMERA',
          width: 1200,
          correctOrientation: true,
        });
        if (photo.base64String) {
          return await ocrViaClaudeVision(photo.base64String, 'image/jpeg');
        }
      } catch (e) {
        console.warn('Native camera failed:', e.message);
      }
    }
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return resolve(null);
        const b64 = await fileToBase64(file);
        const result = await ocrViaClaudeVision(b64, file.type);
        resolve(result);
      };
      input.click();
    });
  }

  // Parse receipt text via Claude API (edge function)
  async function ocrViaClaudeVision(base64, mimeType) {
    try {
      NX.toast('Reading document...', 'info', 3000);
      const { data, error: invokeErr } = await NX.sb.functions.invoke('chat', {
        body: {
          max_tokens: 500,
          user_name: NX.currentUser?.name,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mimeType || 'image/jpeg', data: base64 } },
              { type: 'text', text: `Extract from this receipt/invoice/document. Return ONLY JSON:
{"vendor":"company name","amount":"total $","date":"date","items":["line items"],"notes":"any other details like account numbers, PO numbers, phone numbers"}
If not a receipt, describe what you see in "notes" and set vendor to "Unknown".` }
            ]
          }]
        }
      });
      if (invokeErr) { NX.toast('OCR error', 'error'); return null; }
      const text = data.content?.[0]?.text || '';
      
      try {
        const clean = text.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(clean);
        
        // Auto-create node
        const name = parsed.vendor || 'Scanned Document';
        const notes = [
          parsed.amount ? `Amount: ${parsed.amount}` : '',
          parsed.date ? `Date: ${parsed.date}` : '',
          parsed.items?.length ? `Items: ${parsed.items.join(', ')}` : '',
          parsed.notes || '',
        ].filter(Boolean).join('\n');
        
        const { error } = await NX.sb.from('nodes').insert({
          name: name.slice(0, 200),
          category: 'vendors',
          notes: notes.slice(0, 3000),
          tags: ['scanned', 'receipt'],
          links: [],
          access_count: 1,
        });
        
        if (!error) {
          NX.toast(`✓ ${name} — ${parsed.amount || 'saved'}`, 'success');
          await NX.loadNodes();
          if (NX.brain) NX.brain.init();
        }
        
        // Save image to Supabase Storage
        try {
          const fileName = `receipts/${Date.now()}_${name.replace(/[^a-z0-9]/gi, '_').slice(0, 30)}.jpg`;
          const blob = base64ToBlob(base64, mimeType);
          await NX.sb.storage.from('attachments').upload(fileName, blob);
        } catch (e) {}
        
        return parsed;
      } catch (e) {
        NX.toast('Could not parse document', 'warn');
        return { notes: text };
      }
    } catch (e) {
      NX.toast('Scan failed: ' + e.message, 'error');
      return null;
    }
  }

  async function parseReceiptText(text) {
    // Simple local parse for on-device OCR results
    const lines = text.split('\n').filter(l => l.trim());
    const vendor = lines[0] || 'Unknown';
    const amountMatch = text.match(/\$[\d,]+\.?\d*/);
    const dateMatch = text.match(/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/);
    
    const result = {
      vendor,
      amount: amountMatch ? amountMatch[0] : '',
      date: dateMatch ? dateMatch[0] : new Date().toLocaleDateString(),
      notes: text.slice(0, 500),
    };
    
    // Save as node
    const notes = `Amount: ${result.amount}\nDate: ${result.date}\n${result.notes}`;
    await NX.sb.from('nodes').insert({
      name: result.vendor.slice(0, 200),
      category: 'vendors',
      notes: notes.slice(0, 3000),
      tags: ['scanned', 'receipt'],
      links: [],
      access_count: 1,
    });
    
    NX.toast(`✓ ${result.vendor} — ${result.amount || 'saved'}`, 'success');
    await NX.loadNodes();
    if (NX.brain) NX.brain.init();
    
    return result;
  }

  // ═══ VOICE LOGGING ═══
  // Hold button → speak → auto-transcribed → logged as daily note or chat input
  NX.voiceLog = async function(mode = 'log') {
    // mode: 'log' = save to daily_logs, 'chat' = fill chat input
    
    if (isNative) {
      try {
        const { SpeechRecognition } = await import('@aspect/capacitor-speech-recognition');
        const { available } = await SpeechRecognition.available();
        if (!available) { NX.toast('Speech not available', 'error'); return null; }
        
        await SpeechRecognition.requestPermission();
        NX.toast('🎤 Listening...', 'info', 10000);
        
        const result = await SpeechRecognition.start({
          language: 'en-US',
          maxResults: 1,
          popup: true,
          partialResults: false,
        });
        
        const text = result.matches?.[0] || '';
        if (!text) { NX.toast('Nothing heard', 'warn'); return null; }
        
        return await processVoice(text, mode);
      } catch (e) {
        console.warn('Native speech error, falling back:', e);
      }
    }
    
    // Web Speech API fallback
    if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
      NX.toast('Speech not supported', 'error');
      return null;
    }
    
    return new Promise((resolve) => {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      const rec = new SR();
      rec.lang = 'en-US';
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      
      NX.toast('🎤 Listening...', 'info', 10000);
      
      rec.onresult = async (e) => {
        const text = e.results[0][0].transcript;
        const result = await processVoice(text, mode);
        resolve(result);
      };
      
      rec.onerror = (e) => {
        NX.toast('Voice error: ' + e.error, 'error');
        resolve(null);
      };
      
      rec.start();
      // Auto-stop after 15 seconds
      setTimeout(() => { try { rec.stop(); } catch(e) {} }, 15000);
    });
  };
  
  async function processVoice(text, mode) {
    if (mode === 'chat') {
      const input = document.getElementById('chatInput');
      if (input) { input.value = text; input.dispatchEvent(new Event('input')); }
      NX.toast(`🎤 "${text.slice(0, 40)}..."`, 'success');
      return text;
    }
    
    // Log mode — save to daily_logs
    const { error } = await NX.sb.from('daily_logs').insert({
      entry: `🎤 ${text}`,
      user_id: NX.currentUser?.id || 0,
      user_name: NX.currentUser?.name || 'Voice',
    });
    
    if (!error) {
      NX.toast(`Logged: "${text.slice(0, 50)}"`, 'success');
      // Vibrate confirmation
      if (isNative) {
        try {
          const { Haptics } = await import('@capacitor/haptics');
          await Haptics.notification({ type: 'SUCCESS' });
        } catch(e) {}
      } else if (navigator.vibrate) {
        navigator.vibrate(100);
      }
    }
    
    return text;
  }

  // ═══ BACKGROUND SYNC ═══
  // Keeps data fresh even when app is minimized
  NX.startBackgroundSync = function(intervalMs = 300000) {
    // 5 minutes default
    if (NX._bgSyncTimer) clearInterval(NX._bgSyncTimer);
    
    NX._bgSyncTimer = setInterval(async () => {
      if (!NX.sb || !NX.currentUser) return;
      try {
        // Reload nodes silently
        await NX.loadNodes();
        
        // Check for urgent alerts
        const { data: recentLogs } = await NX.sb.from('daily_logs')
          .select('entry')
          .gte('created_at', new Date(Date.now() - intervalMs).toISOString())
          .like('entry', '%AUTO-TRIAGE%');
        
        if (recentLogs?.length && isNative) {
          try {
            const { LocalNotifications } = await import('@capacitor/local-notifications');
            await LocalNotifications.schedule({
              notifications: [{
                title: '🚨 NEXUS Alert',
                body: recentLogs[0].entry.replace(/🚨 AUTO-TRIAGE:\s*/, '').slice(0, 100),
                id: Date.now(),
                schedule: { at: new Date() },
              }]
            });
          } catch(e) {}
        }
      } catch (e) {}
    }, intervalMs);
  };

  // ═══ SMS LISTENER (APK only) ═══
  // Captures incoming SMS and queues for AI processing
  NX.startSmsListener = async function() {
    if (!isNative) return;
    try {
      // Register broadcast receiver for incoming SMS via Capacitor plugin
      const { SmsReceiver } = await import('capacitor-sms-receiver');
      await SmsReceiver.requestPermission();
      
      SmsReceiver.addListener('smsReceived', async (msg) => {
        const sender = msg.from || msg.address || 'Unknown';
        const body = msg.body || '';
        if (body.length < 3) return;
        
        // Check if this contact is in our watch list
        const watchList = JSON.parse(localStorage.getItem('nexus_sms_watch') || '[]');
        if (watchList.length && !watchList.some(w => sender.includes(w))) return;
        
        // Queue for AI processing
        const id = `sms_live_${Date.now()}_${sender.replace(/\D/g,'').slice(-6)}`;
        try {
          await NX.sb.from('raw_emails').upsert({
            id,
            from_addr: 'SMS: ' + sender,
            to_addr: 'nexus-live',
            date: new Date().toISOString(),
            subject: 'SMS from ' + sender,
            body: body.slice(0, 12000),
            snippet: body.slice(0, 200),
            attachment_count: 0, attachments: [],
            processed: false
          }, { onConflict: 'id' });
          
          NX.localNotify('📱 SMS captured', `${sender}: ${body.slice(0, 60)}`);
        } catch(e) {}
      });
      
      console.log('[NEXUS] SMS listener active');
    } catch(e) {
      console.warn('[NEXUS] SMS listener not available:', e.message);
    }
  };

  // ═══ NOTIFICATION LISTENER (APK only) ═══
  // Captures WhatsApp/other app notifications for passive message collection
  // Requires: Android NotificationListenerService permission
  NX.startNotificationListener = async function() {
    if (!isNative) return;
    try {
      const NotificationListenerPlugin = window.Capacitor?.Plugins?.NotificationListenerPlugin;
      if (!NotificationListenerPlugin) {
        console.warn('[NEXUS] NotificationListenerPlugin not registered');
        return;
      }

      const { enabled } = await NotificationListenerPlugin.isEnabled();
      if (!enabled) {
        await NotificationListenerPlugin.requestPermission();
        NX.toast('Enable NEXUS in Notification Access settings', 'info', 5000);
        return;
      }

      // Watch list — which apps to capture
      const watchApps = JSON.parse(localStorage.getItem('nexus_notify_watch') || '["com.whatsapp","com.whatsapp.w4b","org.telegram.messenger","com.google.android.apps.messaging","com.google.android.gm","com.slack"]');

      await NotificationListenerPlugin.startListening();

      await NotificationListenerPlugin.addListener('notificationReceived', async (notification) => {
        const pkg = notification.packageName || '';
        if (!watchApps.some(a => pkg.includes(a))) return;

        const title = notification.title || '';
        const text = notification.text || '';
        if (text.length < 3) return;

        // Determine source app
        const appName = pkg.includes('whatsapp') ? 'WhatsApp' :
                       pkg.includes('telegram') ? 'Telegram' :
                       pkg.includes('messaging') ? 'SMS' :
                       pkg.includes('com.google.android.gm') ? 'Gmail' :
                       pkg.includes('slack') ? 'Slack' : pkg;

        // Debounce — skip if same message in last 30 seconds
        const dedupeKey = `${title}|${text.slice(0,50)}`;
        if (NX._lastNotify === dedupeKey && Date.now() - (NX._lastNotifyTime||0) < 30000) return;
        NX._lastNotify = dedupeKey;
        NX._lastNotifyTime = Date.now();

        // Queue for AI processing
        const id = `notify_${appName.toLowerCase()}_${Date.now()}`;
        try {
          await NX.sb.from('raw_emails').upsert({
            id,
            from_addr: `${appName}: ${title}`,
            to_addr: 'nexus-live',
            date: new Date().toISOString(),
            subject: `${appName} — ${title}`,
            body: text.slice(0, 12000),
            snippet: text.slice(0, 200),
            attachment_count: 0, attachments: [],
            processed: false
          }, { onConflict: 'id' });

          if (NX.syslog) NX.syslog('notify_captured', `${appName}: ${title} — ${text.slice(0,60)}`);
          
          // Update notification counter
          NX._notifyCount = (NX._notifyCount || 0) + 1;
          const badge = document.getElementById('notifyCount');
          if (badge) { badge.textContent = NX._notifyCount; badge.classList.add('has-count'); }
        } catch(e) {}
      });

      console.log('[NEXUS] Notification listener active for:', watchApps.join(', '));
      NX.toast('Notification capture active', 'success');
      // Show listening indicator
      const dot=document.getElementById('listenDot');
      if(dot)dot.classList.add('active');
      NX._isListening=true;
    } catch(e) {
      console.warn('[NEXUS] Notification listener not available:', e.message);
    }
  };

  // ═══ SMS/NOTIFICATION WATCH LIST MANAGEMENT ═══
  NX.setSmsWatchList = function(contacts) {
    // contacts = ['5125551234', 'John', '+1512...']
    localStorage.setItem('nexus_sms_watch', JSON.stringify(contacts));
    NX.toast(`Watching ${contacts.length} SMS contacts`, 'success');
  };
  
  NX.setNotifyWatchApps = function(apps) {
    // apps = ['com.whatsapp', 'org.telegram.messenger']
    localStorage.setItem('nexus_notify_watch', JSON.stringify(apps));
    NX.toast(`Watching ${apps.length} apps`, 'success');
  };

  // ═══ WEEKLY CHECKLIST SCANNER ═══
  // Scan 3 pages of a weekly laminated checklist → create daily logs for each day
  NX.scanWeeklyChecklist = async function() {
    // (api key check removed — edge function holds the key)

    const cleanTasks = NX.cleaningTasks;
    if (!cleanTasks) { NX.toast('Tasks not loaded', 'error'); return null; }

    const activeTab = document.querySelector('.clean-tab.active');
    const location = activeTab?.dataset?.cloc || 'suerte';
    const locationTasks = cleanTasks[location] || [];

    // Build task reference
    const taskRef = locationTasks.map(sec => {
      return 'SECTION: ' + sec.sec + '\n' + sec.items.map((item, i) =>
        '  ' + i + ': "' + item[0] + '" / "' + item[1] + '"'
      ).join('\n');
    }).join('\n\n');

    const pages = ['Página 1 (Comedor, Baños, Exterior, Cocina)', 'Página 2 (Periódico + Jardín)'];
    const allResults = [];

    for (let pageNum = 0; pageNum < 2; pageNum++) {
      NX.toast('📷 Foto ' + (pageNum + 1) + '/2: ' + pages[pageNum], 'info', 10000);

      let base64, mimeType = 'image/jpeg';

      // Use universal file picker — shows 3-option popup
      if (NX.filePicker) {
        const files = await NX.filePicker.pick({
          accept: 'image/*',
          multiple: false,
          title: `Scan page ${pageNum + 1} of 2`
        });
        if (!files || !files.length) { NX.toast('Scan cancelled', 'warn'); return null; }
        const file = files[0];
        base64 = await fileToBase64(file);
        mimeType = file.type || 'image/jpeg';
      } else {
        // Fallback if picker not loaded
        if (window.Capacitor?.Plugins?.Camera) {
          try {
            const Camera = window.Capacitor.Plugins.Camera;
            const photo = await Camera.getPhoto({
              quality: 90, resultType: 'base64', source: 'CAMERA',
              width: 2000, correctOrientation: true,
            });
            if (photo.base64String) { base64 = photo.base64String; mimeType = 'image/' + (photo.format || 'jpeg'); }
          } catch (e) { if (e.message?.includes('cancelled')) { NX.toast('Scan cancelled', 'warn'); return null; } }
        }
        if (!base64) {
          base64 = await new Promise((resolve) => {
            const input = document.createElement('input');
            input.type = 'file'; input.accept = 'image/*';
            input.onchange = async (e) => {
              const file = e.target.files?.[0];
              if (!file) return resolve(null);
              resolve(await fileToBase64(file));
            };
            input.click();
          });
          if (!base64) { NX.toast('Scan cancelled', 'warn'); return null; }
        }
      }

      NX.toast('🔍 Leyendo página ' + (pageNum + 1) + '...', 'info', 8000);

      try {
        const { data, error: invokeErr } = await NX.sb.functions.invoke('chat', {
          body: {
            max_tokens: 2000,
            user_name: NX.currentUser?.name,
            messages: [{ role: 'user', content: [
              { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
              { type: 'text', text: 'This is page ' + (pageNum + 1) + ' of 2 of a WEEKLY cleaning checklist for "' + location.toUpperCase() + '". It has 7 day columns: L (Lunes/Mon), MA (Martes/Tue), MI (Miércoles/Wed), J (Jueves/Thu), V (Viernes/Fri), S (Sábado/Sat), D (Domingo/Sun).\n\nThe checkboxes are ☐ when empty and should have a mark (☑, ✓, X, or any filling) when completed.\n\nRead EVERY task row and report which boxes are checked for EACH of the 7 days.\n\nKnown tasks:\n' + taskRef + '\n\nReturn ONLY valid JSON:\n{"results": [{"section": "section name", "task_index": <number>, "days": [<true/false for L>, <true/false for MA>, <true/false for MI>, <true/false for J>, <true/false for V>, <true/false for S>, <true/false for D>]}], "additions": [{"section": "section name or New", "text_es": "Spanish", "text_en": "English", "days": [7 booleans]}]}\n\nIMPORTANT: Include ALL tasks visible on this page. The "days" array must always have exactly 7 booleans. Match section names to the known tasks above. If a checkbox has ANY mark in it, report true.' }
            ]}]
          }
        });
        if (invokeErr) throw invokeErr;
        const text = data.content?.[0]?.text || '';
        let clean = text.replace(/```json|```/g, '').trim();
        const s = clean.indexOf('{'), e = clean.lastIndexOf('}');
        if (s !== -1 && e > s) {
          const parsed = JSON.parse(clean.slice(s, e + 1));
          allResults.push({ page: pageNum + 1, ...parsed });
        }
      } catch (e) {
        NX.toast('Error page ' + (pageNum + 1) + ': ' + e.message, 'error');
      }

      // Save photo
      try {
        const today = new Date().toISOString().split('T')[0];
        const blob = base64ToBlob(base64, mimeType);
        await NX.sb.storage.from('attachments').upload(
          'cleaning-scans/' + today + '_' + location + '_p' + (pageNum + 1) + '.jpg', blob
        );
      } catch (e) {}
    }

    // ═══ PROCESS ALL PAGES → CREATE DAILY LOGS ═══
    if (!allResults.length) { NX.toast('No results from scan', 'error'); return null; }

    // Determine the week dates (Mon-Sun of the scanned week)
    // Assume current week — find last Monday
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon, ...
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(now);
    monday.setDate(now.getDate() + mondayOffset);

    const weekDates = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(monday);
      date.setDate(monday.getDate() + d);
      weekDates.push(date.toISOString().split('T')[0]);
    }

    let totalUpserts = 0;
    const daySummary = [0, 0, 0, 0, 0, 0, 0]; // checked count per day

    for (const pageResult of allResults) {
      for (const result of (pageResult.results || [])) {
        const days = result.days || [];
        for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
          if (dayIdx >= days.length) continue;
          const checked = days[dayIdx];
          if (checked) daySummary[dayIdx]++;

          try {
            await NX.sb.from('cleaning_logs').upsert({
              location: location,
              log_date: weekDates[dayIdx],
              task_index: result.task_index,
              section: result.section,
              done: checked,
              completed_at: checked ? new Date().toISOString() : null,
            }, { onConflict: 'location,log_date,task_index,section' });
            totalUpserts++;
          } catch (e) {}
        }
      }

      // Handle additions
      for (const add of (pageResult.additions || [])) {
        if (NX.cleaningAPI && NX.cleaningAPI.addTask) {
          NX.cleaningAPI.addTask(location, add.section || 'Custom', add.text_es || add.text_en, add.text_en || add.text_es);
        }
      }
    }

    // Create daily log summaries for each day
    const dayNames = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
    for (let d = 0; d < 7; d++) {
      if (daySummary[d] > 0) {
        try {
          await NX.sb.from('daily_logs').insert({
            entry: '📷 Cleaning: ' + location + ' ' + dayNames[d] + ' — ' + daySummary[d] + ' tasks completed (scanned from weekly sheet)',
            user_name: NX.currentUser?.name || location.toUpperCase(),
            created_at: weekDates[d] + 'T18:00:00.000Z',
          });
        } catch (e) {}
      }
    }

    // Summary
    const totalChecked = daySummary.reduce((a, b) => a + b, 0);
    const activeDays = daySummary.filter(d => d > 0).length;
    NX.toast('✓ ' + location + ': ' + totalChecked + ' checks across ' + activeDays + ' days logged', 'success', 6000);

    if (NX.modules.clean && NX.modules.clean.show) NX.modules.clean.show();

    return { location, weekDates, daySummary, totalUpserts };
  };

  // ═══ CHECKLIST SCANNER ═══
  // Photograph laminated cleaning sheet → Claude Vision reads checked items → auto-log
  NX.scanChecklist = async function() {
    let base64, mimeType = 'image/jpeg';

    // Capture photo
    if (isNative && window.Capacitor?.Plugins?.Camera) {
      try {
        const Camera = window.Capacitor.Plugins.Camera;
        const photo = await Camera.getPhoto({
          quality: 90,
          resultType: 'base64',
          source: 'CAMERA',
          width: 2000,      // High res for reading checkmarks
          correctOrientation: true,
        });
        if (photo.base64String) {
          base64 = photo.base64String;
          mimeType = 'image/' + (photo.format || 'jpeg');
        }
      } catch (e) {
        if (e.message?.includes('cancelled')) return null;
      }
    }

    // Web fallback
    if (!base64) {
      base64 = await new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.capture = 'environment';
        input.onchange = async (e) => {
          const file = e.target.files?.[0];
          if (!file) return resolve(null);
          resolve(await fileToBase64(file));
        };
        input.click();
      });
      if (!base64) return null;
    }

    // (api key check removed — edge function holds the key)

    NX.toast('📷 Reading checklist...', 'info', 8000);

    // Get the current location's task list for reference
    const cleanTasks = NX.cleaningTasks;
    if (!cleanTasks) { NX.toast('Cleaning tasks not loaded', 'error'); return null; }

    // Detect which location tab is active
    const activeTab = document.querySelector('.clean-tab.active');
    const location = activeTab?.dataset?.cloc || 'suerte';
    const locationTasks = cleanTasks[location] || [];

    // Build the task reference for Claude — so it knows exactly what to look for
    const taskRef = locationTasks.map(sec => {
      return `SECTION: ${sec.sec}\n` + sec.items.map((item, i) => 
        `  ${i}: "${item[0]}" / "${item[1]}"`
      ).join('\n');
    }).join('\n\n');

    try {
      const { data, error: invokeErr } = await NX.sb.functions.invoke('chat', {
        body: {
          max_tokens: 1500,
          user_name: NX.currentUser?.name,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
              { type: 'text', text: `This is a photograph of a laminated restaurant cleaning checklist filled out with dry-erase marker. The sheet has checkboxes for each day of the week (Mon-Sun).

TWO TASKS:

TASK 1 — READ CHECKMARKS:
Read each row and determine which checkboxes are CHECKED (marked, filled, X'd, ticked) versus UNCHECKED (empty, blank).

TASK 2 — DETECT HANDWRITTEN ADDITIONS:
Look for any HANDWRITTEN text that was ADDED to the sheet — new tasks written in pen or marker that are NOT part of the original printed template. These could appear at the bottom of a section, in margins, or between existing rows. Also look for crossed-out or modified printed tasks.

The location is "${location.toUpperCase()}" and here are the ORIGINAL PRINTED tasks:

${taskRef}

Return ONLY valid JSON in this exact format:
{
  "day_index": <0-6 where 0=Monday>,
  "results": [{"section": "section name", "task_index": <number>, "checked": <true/false>}],
  "additions": [{"section": "section name or 'New'", "text_es": "Spanish text if visible", "text_en": "English text or description", "checked": <true/false>}],
  "modifications": [{"section": "section name", "task_index": <number>, "note": "what was changed — crossed out, arrow, note added"}]
}

IMPORTANT:
- Determine which DAY column has the most markings — that's today's column.
- If multiple days are filled, use the RIGHTMOST filled column.
- Include ALL tasks in results, both checked and unchecked.
- Only include "additions" if you see genuinely NEW handwritten text not in the original template.
- Only include "modifications" if an original task was visibly crossed out or altered.
- If no additions or modifications, return empty arrays for those fields.` }
            ]
          }]
        }
      });
      if (invokeErr) { NX.toast('OCR error', 'error'); return null; }

      const text = data?.content?.[0]?.text || '';
      
      // Parse response
      let clean = text.replace(/```json|```/g, '').trim();
      const s = clean.indexOf('{'), e = clean.lastIndexOf('}');
      if (s === -1 || e <= s) {
        NX.toast('Could not read checklist', 'error');
        return null;
      }
      const parsed = JSON.parse(clean.slice(s, e + 1));
      
      if (!parsed.results || !parsed.results.length) {
        NX.toast('No tasks detected in photo', 'warn');
        return null;
      }

      // ═══ APPLY RESULTS TO CLEANING SYSTEM ═══
      const today = new Date();
      // Use 8AM rollover logic
      if (today.getHours() < 8) today.setDate(today.getDate() - 1);
      const dateStr = today.getFullYear() + '-' + 
        String(today.getMonth() + 1).padStart(2, '0') + '-' + 
        String(today.getDate()).padStart(2, '0');

      let checked = 0, total = 0;
      const upserts = [];

      for (const result of parsed.results) {
        total++;
        if (result.checked) checked++;
        
        upserts.push({
          location: location,
          log_date: dateStr,
          task_index: result.task_index,
          section: result.section,
          done: result.checked,
          completed_at: result.checked ? new Date().toISOString() : null,
        });
      }

      // Batch upsert to database
      let saved = 0;
      for (const u of upserts) {
        try {
          const { error } = await NX.sb.from('cleaning_logs').upsert(u, {
            onConflict: 'location,log_date,task_index,section'
          });
          if (!error) saved++;
        } catch (e) {}
      }

      const pct = total > 0 ? Math.round((checked / total) * 100) : 0;
      
      // Log to daily_logs
      try {
        await NX.sb.from('daily_logs').insert({
          entry: `📷 Cleaning scan: ${location} — ${checked}/${total} (${pct}%) — scanned from photo`,
          user_name: NX.currentUser?.name || 'Scanner',
        });
      } catch (e) {}

      // Haptic feedback
      if (isNative) {
        try { const { Haptics } = await import('@capacitor/haptics'); Haptics.notification({ type: 'SUCCESS' }); } catch(e) {}
      }

      NX.toast(`✓ ${location}: ${checked}/${total} tasks (${pct}%) — ${saved} logged`, 'success', 5000);

      // ═══ PROCESS HANDWRITTEN ADDITIONS ═══
      const additions = parsed.additions || [];
      if (additions.length) {
        for (const add of additions) {
          const section = add.section || 'Custom';
          const es = add.text_es || add.text_en || '';
          const en = add.text_en || add.text_es || '';
          if (!en && !es) continue;

          // Add as custom task via the cleaning API
          if (NX.cleaningAPI && NX.cleaningAPI.addTask) {
            NX.cleaningAPI.addTask(location, section, es || en, en || es);
          }

          // Also save to capture_queue for tracking
          try {
            await NX.sb.from('capture_queue').insert({
              capture_type: 'text',
              raw_content: `[SCAN-ADDITION] ${location}/${section}: ${en} / ${es}`,
              processed: true,
              user_name: NX.currentUser?.name || 'Scanner',
            });
          } catch (e) {}
        }
        NX.toast(`+ ${additions.length} new task${additions.length > 1 ? 's' : ''} added from sheet`, 'info', 4000);
      }

      // ═══ PROCESS MODIFICATIONS ═══
      const modifications = parsed.modifications || [];
      if (modifications.length) {
        // Log modifications but don't auto-delete (safety)
        for (const mod of modifications) {
          try {
            await NX.sb.from('daily_logs').insert({
              entry: `[SCAN-MODIFICATION] ${location}/${mod.section} task #${mod.task_index}: ${mod.note}`,
              user_name: NX.currentUser?.name || 'Scanner',
            });
          } catch (e) {}
        }
        NX.toast(`⚠ ${modifications.length} task modification${modifications.length > 1 ? 's' : ''} detected — logged for review`, 'warn', 4000);
      }

      // Refresh the cleaning view
      if (NX.modules.clean && NX.modules.clean.show) {
        NX.modules.clean.show();
      }

      // Save the photo as proof
      try {
        const fileName = `cleaning-scans/${dateStr}_${location}_${Date.now()}.jpg`;
        const blob = base64ToBlob(base64, mimeType);
        await NX.sb.storage.from('attachments').upload(fileName, blob);
      } catch (e) {}

      return { location, date: dateStr, checked, total, pct };

    } catch (e) {
      NX.toast('Scan failed: ' + e.message, 'error');
      return null;
    }
  };

  // ═══ SHARE ═══
  // Share node info, reports, etc.
  NX.shareContent = async function(title, text) {
    if (isNative) {
      try {
        const { Share } = await import('@capacitor/share');
        await Share.share({ title, text, dialogTitle: 'Share from NEXUS' });
        return;
      } catch(e) {}
    }
    // Web fallback
    if (navigator.share) {
      await navigator.share({ title, text });
    } else {
      await navigator.clipboard.writeText(text);
      NX.toast('Copied to clipboard', 'success');
    }
  };

  // ═══ NATIVE NOTIFICATIONS ═══
  NX.localNotify = async function(title, body) {
    if (isNative) {
      try {
        const { LocalNotifications } = await import('@capacitor/local-notifications');
        await LocalNotifications.requestPermissions();
        await LocalNotifications.schedule({
          notifications: [{
            title,
            body,
            id: Date.now(),
            schedule: { at: new Date(Date.now() + 1000) },
          }]
        });
        return;
      } catch(e) {}
    }
    // Web fallback
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body, icon: '/icon-192.png' });
    }
  };

  // ═══ NATIVE CALENDAR ═══
  // Read/write device calendar — syncs with Google Calendar via Android
  NX.calNative = {
    async getEvents(startDate, endDate) {
      if (!isNative) return [];
      try {
        const { Calendar } = await import('@capacitor-community/calendar');
        const { granted } = await Calendar.requestPermissions();
        if (!granted) { NX.toast('Calendar permission denied', 'error'); return []; }
        const result = await Calendar.getEvents({
          startDate: startDate || new Date().toISOString(),
          endDate: endDate || new Date(Date.now() + 14 * 86400000).toISOString(),
        });
        return (result.events || []).map(e => ({
          id: e.id,
          title: e.title || '',
          start: e.startDate || e.dtstart,
          end: e.endDate || e.dtend,
          location: e.eventLocation || e.location || '',
          allDay: e.allDay || false,
          notes: e.description || '',
          source: 'device',
        }));
      } catch (e) {
        console.warn('[Calendar] Native read failed:', e.message);
        return [];
      }
    },

    async createEvent(title, startDate, endDate, location, notes) {
      if (!isNative) { NX.toast('Calendar requires the app', 'warn'); return false; }
      try {
        const { Calendar } = await import('@capacitor-community/calendar');
        const { granted } = await Calendar.requestPermissions();
        if (!granted) return false;
        await Calendar.createEvent({
          title,
          startDate: startDate || new Date(Date.now() + 86400000).toISOString(),
          endDate: endDate || new Date(Date.now() + 86400000 + 3600000).toISOString(),
          location: location || '',
          notes: notes || '',
        });
        NX.toast(`📅 ${title} added to calendar`, 'success');
        if (isNative) {
          try { const{Haptics}=await import('@capacitor/haptics');Haptics.notification({type:'SUCCESS'}); } catch(e){}
        }
        return true;
      } catch (e) {
        NX.toast('Calendar write failed: ' + e.message, 'error');
        return false;
      }
    },

    // Merge device calendar events into NEXUS calendar view
    async mergeIntoView() {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const end = new Date(now.getFullYear(), now.getMonth() + 2, 0).toISOString();
      const events = await this.getEvents(start, end);
      if (!events.length) return;
      // Store for calendar.js to read
      NX._deviceCalEvents = events;
      console.log(`[Calendar] Loaded ${events.length} device events`);
    }
  };

  // ═══ SMART PHOTO CAPTURE ═══
  // General-purpose: photo → Claude vision → auto-categorize → create node
  NX.smartCapture = async function() {
    let base64, mimeType = 'image/jpeg';

    if (isNative && window.Capacitor?.Plugins?.Camera) {
      try {
        const Camera = window.Capacitor.Plugins.Camera;
        const photo = await Camera.getPhoto({
          quality: 85,
          resultType: 'base64',
          source: 'PROMPT', // Let user choose camera or gallery
          width: 1400,
          correctOrientation: true,
        });
        if (photo.base64String) {
          base64 = photo.base64String;
          mimeType = 'image/' + (photo.format || 'jpeg');
        }
      } catch (e) {
        if (e.message?.includes('cancelled')) return null;
        console.warn('Native camera failed:', e.message);
      }
    }

    // Web fallback
    if (!base64) {
      base64 = await new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.capture = 'environment';
        input.onchange = async (e) => {
          const file = e.target.files?.[0];
          if (!file) return resolve(null);
          resolve(await fileToBase64(file));
        };
        input.click();
      });
      if (!base64) return null;
    }

    // Send to Claude vision for smart categorization (edge function)
    NX.toast('🔍 Analyzing...', 'info', 5000);
    try {
      const { data, error: invokeErr } = await NX.sb.functions.invoke('chat', {
        body: {
          max_tokens: 500,
          user_name: NX.currentUser?.name,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
              { type: 'text', text: `Analyze this image. What is it? Return ONLY JSON:
{"name":"short descriptive title","category":"one of: equipment|contractors|vendors|people|procedure|location|parts|projects|systems","notes":"detailed description including any text, numbers, model numbers, prices, dates visible","tags":["relevant","tags"]}
Be specific. If it's equipment, include the make/model. If it's a document, extract key info. If it's a person, describe the context.` }
            ]
          }]
        }
      });
      if (invokeErr) { NX.toast('Vision error', 'error'); return null; }

      const text = data?.content?.[0]?.text || '';
      const clean = text.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(clean);

      // Create node
      const { error } = await NX.sb.from('nodes').insert({
        name: (parsed.name || 'Photo Capture').slice(0, 200),
        category: parsed.category || 'projects',
        notes: (parsed.notes || '').slice(0, 3000),
        tags: [...(parsed.tags || []), 'photo-capture'],
        links: [],
        access_count: 1,
      });

      if (!error) {
        NX.toast(`✓ ${parsed.name}`, 'success');
        // Save image to storage
        try {
          const fileName = `captures/${Date.now()}_${(parsed.name||'').replace(/[^a-z0-9]/gi,'_').slice(0,30)}.jpg`;
          const blob = base64ToBlob(base64, mimeType);
          await NX.sb.storage.from('attachments').upload(fileName, blob);
        } catch (e) {}
        // Also queue in capture_queue for tracking
        try {
          await NX.sb.from('capture_queue').insert({
            capture_type: 'photo',
            raw_content: parsed.name + ': ' + (parsed.notes || '').slice(0, 500),
            processed: true,
            user_name: NX.currentUser?.name || 'Unknown',
          });
        } catch (e) {}
        await NX.loadNodes();
        if (NX.brain) NX.brain.init();
        if (isNative) {
          try { const{Haptics}=await import('@capacitor/haptics');Haptics.notification({type:'SUCCESS'}); } catch(e){}
        }
      }
      return parsed;
    } catch (e) {
      NX.toast('Capture failed: ' + e.message, 'error');
      return null;
    }
  };

  // ═══ PUSH NOTIFICATIONS (Firebase Cloud Messaging) ═══
  //
  // Stage T: robust registration with three properties:
  //   1. Only called when the user is logged in (permission prompt
  //      happens in context, not as a cold open).
  //   2. Idempotent — safe to call multiple times. Second call is
  //      a no-op if already registered.
  //   3. If the FCM token arrives BEFORE the user row is known
  //      (race on slow networks), it's cached and uploaded later.
  //
  // Flow:
  //   A. User logs in → app.js._loadConfigAndStart() → calls NX.pushNotify.register()
  //   B. register() asks for permission, calls Capacitor's register()
  //   C. Capacitor fires 'registration' listener with FCM token
  //   D. If NX.currentUser known → upload immediately to nexus_users.push_token
  //      Else → stash in NX.pushNotify.pendingToken → upload on next login
  //   E. register() resolves true on success
  NX.pushNotify = {
    token: null,
    pendingToken: null,        // token received before user row known
    registered: false,         // prevents double-register

    async register() {
      if (!isNative) return false;
      if (this.registered) {
        // Already registered — if we have a pending token waiting for
        // the user, upload it now.
        await this._flushPendingToken();
        return true;
      }
      try {
        const { PushNotifications } = await import('@capacitor/push-notifications');
        const perm = await PushNotifications.requestPermissions();
        if (perm.receive !== 'granted') {
          console.warn('[Push] Permission denied by user');
          return false;
        }
        await PushNotifications.register();

        PushNotifications.addListener('registration', async (token) => {
          NX.pushNotify.token = token.value;
          console.log('[Push] Got FCM token');
          await NX.pushNotify._uploadToken(token.value);
        });

        PushNotifications.addListener('registrationError', (err) => {
          console.warn('[Push] Registration error:', err?.error || err);
        });

        PushNotifications.addListener('pushNotificationReceived', (notification) => {
          console.log('[Push] Received (foreground):', notification);
          // Show as in-app toast — the system tray notification
          // doesn't appear while app is in foreground on Android
          NX.toast(
            (notification.title || 'Notification') + ': ' + (notification.body || '').slice(0, 80),
            'info',
            5000
          );
          // Pulse the mini-galaxy — the brain noticed
          if (NX.homeGalaxyPulse) NX.homeGalaxyPulse();
        });

        PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
          console.log('[Push] Tapped:', action);
          const data = action.notification?.data || {};
          if (NX.deepLink && data.view) {
            const id = data.equipment_id || data.pattern_id || data.dispatch_id || '';
            NX.deepLink.handle({
              view: data.view,
              id: id,
              alertType: data.alert_type,
            });
          } else if (data.view) {
            // Fallback if deepLink isn't loaded: just switch view
            const tab = document.querySelector(`.bnav-btn[data-view="${data.view}"]`);
            if (tab) tab.click();
          }
        });

        this.registered = true;
        console.log('[Push] Registered — awaiting FCM token');
        return true;
      } catch (e) {
        console.warn('[Push] Setup failed:', e.message);
        return false;
      }
    },

    // Upload a token to the current user's row. If no user known,
    // stash for later.
    async _uploadToken(token) {
      if (!token) return;
      if (!NX.sb || !NX.currentUser) {
        // User not logged in yet — stash and upload on login
        this.pendingToken = token;
        console.log('[Push] Token cached, pending user login');
        return;
      }
      try {
        const { error } = await NX.sb.from('nexus_users')
          .update({ push_token: token })
          .eq('id', NX.currentUser.id);
        if (error) throw error;
        this.pendingToken = null;
        console.log('[Push] Token uploaded for', NX.currentUser.name);
      } catch (e) {
        console.warn('[Push] Token upload failed:', e?.message);
        // Keep it pending for retry
        this.pendingToken = token;
      }
    },

    // Called after login. If there's a token cached from an earlier
    // session (or if registration fired before user load), upload it.
    async _flushPendingToken() {
      if (this.pendingToken && NX.sb && NX.currentUser) {
        await this._uploadToken(this.pendingToken);
      } else if (this.token && NX.sb && NX.currentUser) {
        // Even if not "pending", re-upload on every login so switching
        // users on one device routes future pushes to the right row.
        await this._uploadToken(this.token);
      }
    },

    // Call on logout — clear this device's token from the previous
    // user's row so they stop receiving pushes meant for others.
    async clearOnLogout() {
      if (!NX.sb || !NX.currentUser) return;
      try {
        await NX.sb.from('nexus_users')
          .update({ push_token: null })
          .eq('id', NX.currentUser.id);
      } catch (e) { /* non-fatal */ }
    },
  };

  // ═══ BIOMETRIC AUTH ═══
  // Fingerprint / face unlock replaces PIN entry
  NX.biometric = {
    available: false,
    async check() {
      if (!isNative) return false;
      try {
        const { NativeBiometric } = await import('capacitor-native-biometric');
        const result = await NativeBiometric.isAvailable();
        this.available = result.isAvailable;
        return result.isAvailable;
      } catch (e) {
        return false;
      }
    },

    async authenticate() {
      if (!isNative || !this.available) return false;
      try {
        const { NativeBiometric } = await import('capacitor-native-biometric');
        await NativeBiometric.verifyIdentity({
          reason: 'Unlock NEXUS',
          title: 'NEXUS',
          subtitle: 'Authenticate to continue',
          useFallback: true, // Allow PIN fallback
          maxAttempts: 3,
        });
        return true;
      } catch (e) {
        console.warn('[Biometric] Auth failed:', e.message);
        return false;
      }
    },

    // Store credentials securely in device keychain
    async saveCredentials(pin) {
      if (!isNative) return;
      try {
        const { NativeBiometric } = await import('capacitor-native-biometric');
        await NativeBiometric.setCredentials({
          username: 'nexus_user',
          password: pin,
          server: 'nexus.app',
        });
      } catch (e) {}
    },

    async getCredentials() {
      if (!isNative) return null;
      try {
        const { NativeBiometric } = await import('capacitor-native-biometric');
        const cred = await NativeBiometric.getCredentials({ server: 'nexus.app' });
        return cred.password || null;
      } catch (e) {
        return null;
      }
    }
  };

  // ═══ INIT ═══
  function initNative() {
    
    // Start background sync
    NX.startBackgroundSync();
    
    // Start message listeners (APK only — fail silently on PWA)
    NX.startSmsListener();
    NX.startNotificationListener();
    
    // Stage T: push notifications now register AFTER login
    // (from app.js._loadConfigAndStart) so the permission prompt
    // appears in context — not as a cold open before the user even
    // sees what the app does.
    // NX.pushNotify.register();
    
    // Check biometric availability
    NX.biometric.check();

    // Load device calendar events
    NX.calNative.mergeIntoView();
    
    // Set status bar color on native
    if (isNative) {
      import('@capacitor/status-bar').then(({ StatusBar, Style }) => {
        StatusBar.setStyle({ style: Style.Dark });
        StatusBar.setBackgroundColor({ color: '#111116' });
      }).catch(() => {});
      
      // Hide splash screen
      import('@capacitor/splash-screen').then(({ SplashScreen }) => {
        SplashScreen.hide();
      }).catch(() => {});

      // Ask to disable battery optimization (one-time)
      promptBatteryOptimization();
    }
    
    // ═══ VISIBILITY CHANGE — restart sync when app comes back ═══
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        console.log('[NEXUS] App resumed — re-syncing');
        // Restart background sync timer (it may have been frozen)
        NX.startBackgroundSync();
        // Immediately reload nodes and check for new data
        if (NX.sb && NX.currentUser) {
          NX.loadNodes?.().catch(() => {});
          // Re-check connection
          NX.sb.from('nexus_config').select('id').limit(1).then(() => {
            // Connection OK — dismiss any offline banner
            const banner = document.getElementById('offlineBanner');
            if (banner) banner.style.display = 'none';
          }).catch(() => {});
        }
      }
    });

    // Also handle Android-specific resume event from Capacitor
    if (isNative) {
      document.addEventListener('resume', () => {
        console.log('[NEXUS] Capacitor resume — re-syncing');
        NX.startBackgroundSync();
        if (NX.sb && NX.currentUser) {
          NX.loadNodes?.().catch(() => {});
        }
      });
    }
    
    console.log(`[NEXUS] Native bridge loaded. isNative=${isNative}`);
  }

  // ═══ BATTERY OPTIMIZATION — ask Android to not throttle NEXUS ═══
  function promptBatteryOptimization() {
    // Only ask once per install
    if (localStorage.getItem('nexus_battery_prompted')) return;
    localStorage.setItem('nexus_battery_prompted', 'true');
    
    // Use Capacitor to trigger Android's battery optimization exemption dialog
    // This is the proper way — user sees a system dialog, not a sketchy permission
    try {
      if (window.Capacitor?.Plugins?.App) {
        // The App plugin can launch Android intents
        // For battery optimization, we just log the recommendation
        console.log('[NEXUS] Tip: Disable battery optimization for NEXUS in Android Settings → Apps → NEXUS → Battery → Unrestricted');
      }
    } catch (e) {}
  }

  // ═══ UTILS ═══
  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
  
  function base64ToBlob(b64, mime) {
    const bytes = atob(b64);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    return new Blob([arr], { type: mime || 'image/jpeg' });
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initNative);
  } else {
    initNative();
  }
})();

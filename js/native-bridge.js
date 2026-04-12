/* NEXUS Native Bridge — phone hardware access
   This file detects if running inside the Android app (Capacitor)
   and enables native features: camera OCR, voice, barcode, notifications.
   When running as a PWA, it gracefully falls back to web APIs.
*/
(function(){
  const isNative = window.Capacitor !== undefined;
  
  // ═══ RECEIPT / DOCUMENT SCANNER ═══
  // Camera → photo → on-device OCR → extract vendor, amount, date → create node
  NX.scanReceipt = async function() {
    if (!isNative) {
      // PWA fallback — use file input
      return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.capture = 'environment';
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
    
    try {
      const { Camera } = await import('@capacitor/camera');
      const photo = await Camera.getPhoto({
        quality: 85,
        resultType: 'base64',
        source: 'CAMERA',
        width: 1200,
        correctOrientation: true,
      });
      
      if (!photo.base64String) return null;
      
      // Try on-device OCR first via ML Kit
      let ocrText = '';
      try {
        const { TextRecognition } = await import('@aspect/capacitor-mlkit-text-recognition');
        const result = await TextRecognition.recognizeText({
          base64: photo.base64String,
        });
        ocrText = result.text || '';
      } catch (e) {
        // ML Kit not available — fall through to Claude Vision
      }
      
      // If on-device OCR got text, use it; otherwise use Claude Vision
      if (ocrText.length > 20) {
        return await parseReceiptText(ocrText);
      } else {
        return await ocrViaClaudeVision(photo.base64String, 'image/jpeg');
      }
    } catch (e) {
      console.warn('Camera error:', e);
      return null;
    }
  };

  // Parse receipt text via Claude API
  async function ocrViaClaudeVision(base64, mimeType) {
    const apiKey = NX.getApiKey();
    if (!apiKey) { NX.toast('No API key', 'error'); return null; }
    
    try {
      NX.toast('Reading document...', 'info', 3000);
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 500,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mimeType || 'image/jpeg', data: base64 } },
              { type: 'text', text: `Extract from this receipt/invoice/document. Return ONLY JSON:
{"vendor":"company name","amount":"total $","date":"date","items":["line items"],"notes":"any other details like account numbers, PO numbers, phone numbers"}
If not a receipt, describe what you see in "notes" and set vendor to "Unknown".` }
            ]
          }]
        })
      });
      
      const data = await resp.json();
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
      // This uses a custom Capacitor plugin that wraps Android's NotificationListenerService
      // The plugin must be installed separately — see BUILD-GUIDE.md
      const { NotificationListener } = await import('capacitor-notification-listener');
      
      const { enabled } = await NotificationListener.isEnabled();
      if (!enabled) {
        // Prompt user to enable in Android settings
        await NotificationListener.requestPermission();
        NX.toast('Enable NEXUS in Notification Access settings', 'info', 5000);
        return;
      }
      
      // Watch list — which apps to capture
      const watchApps = JSON.parse(localStorage.getItem('nexus_notify_watch') || '["com.whatsapp","com.whatsapp.w4b","org.telegram.messenger"]');
      
      NotificationListener.addListener('notificationReceived', async (notification) => {
        const pkg = notification.packageName || '';
        if (!watchApps.some(a => pkg.includes(a))) return;
        
        const title = notification.title || '';
        const text = notification.text || '';
        if (text.length < 3) return;
        
        // Determine source app
        const appName = pkg.includes('whatsapp') ? 'WhatsApp' : 
                       pkg.includes('telegram') ? 'Telegram' : pkg;
        
        // Debounce — skip if same message in last 30 seconds
        const dedupeKey = `${title}|${text.slice(0,50)}`;
        if (NX._lastNotify === dedupeKey && Date.now() - (NX._lastNotifyTime||0) < 30000) return;
        NX._lastNotify = dedupeKey;
        NX._lastNotifyTime = Date.now();
        
        // Queue for AI processing
        const id = `notify_${pkg.split('.').pop()}_${Date.now()}`;
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
        } catch(e) {}
      });
      
      console.log('[NEXUS] Notification listener active for:', watchApps.join(', '));
    } catch(e) {
      console.warn('[NEXUS] Notification listener not available:', e.message);
      // Expected on PWA — this only works in the APK
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

  // ═══ UI — Add native action buttons to the nav ═══
  function addNativeButtons() {
    // Wait for DOM
    const nav = document.querySelector('.nav');
    if (!nav) { setTimeout(addNativeButtons, 500); return; }
    
    // Scan button (camera icon)
    const scanBtn = document.createElement('button');
    scanBtn.className = 'nav-tab native-btn';
    scanBtn.innerHTML = '📷';
    scanBtn.title = 'Scan Receipt';
    scanBtn.addEventListener('click', async () => {
      const result = await NX.scanReceipt();
      if (result) {
        // Open chat with result context
        const input = document.getElementById('chatInput');
        if (input) {
          input.value = `I just scanned a receipt from ${result.vendor || 'a vendor'}`;
          input.dispatchEvent(new Event('input'));
        }
      }
    });
    
    // Voice button (mic icon)
    const voiceBtn = document.createElement('button');
    voiceBtn.className = 'nav-tab native-btn';
    voiceBtn.innerHTML = '🎙';
    voiceBtn.title = 'Voice Log';
    let voiceHoldTimer = null;
    
    // Tap = log mode, Long press = chat mode
    voiceBtn.addEventListener('click', () => NX.voiceLog('log'));
    voiceBtn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      NX.voiceLog('chat');
    });
    
    // Insert before the settings gear
    const gear = nav.querySelector('[data-view="admin"]') || nav.lastElementChild;
    nav.insertBefore(scanBtn, gear);
    nav.insertBefore(voiceBtn, gear);
  }

  // ═══ INIT ═══
  function initNative() {
    addNativeButtons();
    
    // Start background sync
    NX.startBackgroundSync();
    
    // Start message listeners (APK only — fail silently on PWA)
    NX.startSmsListener();
    NX.startNotificationListener();
    
    // Set status bar color on native
    if (isNative) {
      import('@capacitor/status-bar').then(({ StatusBar, Style }) => {
        StatusBar.setStyle({ style: Style.Dark });
        StatusBar.setBackgroundColor({ color: '#0a0a0c' });
      }).catch(() => {});
      
      // Hide splash screen
      import('@capacitor/splash-screen').then(({ SplashScreen }) => {
        SplashScreen.hide();
      }).catch(() => {});
    }
    
    console.log(`[NEXUS] Native bridge loaded. isNative=${isNative}`);
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

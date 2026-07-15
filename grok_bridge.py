#!/usr/bin/env python3
# grok_bridge.py — the CHEAP + EFFICIENT bridge to Grok using AO's grok.com SUBSCRIPTION (no API, no per-call fee).
# A PERSISTENT daemon: it keeps ONE warm, logged-in grok.com tab open and serves requests from a local file
# queue, so each ask is fast (no cold Chrome launch) and vision-capable (it attaches the bot's eye-PNG).
#
#   request : %USERPROFILE%\.clippy\grok\req_<id>.json   {"prompt": "...", "image": "C:\\...\\eyes.png" (optional), "fresh": false}
#   answer  : %USERPROFILE%\.clippy\grok\resp_<id>.json  {"answer": "...", "ts": 169..., "ok": true}
#   heartbeat: %USERPROFILE%\.clippy\hb_grokbridge.txt   (a keeper can revive the daemon if it dies)
#
# The bot writes a req_, polls for resp_, executes. Grok is consulted every ~20-60s as a STRATEGIST; the bot
# acts autonomously between consults -> a handful of asks/min, warm session -> cheap and efficient.
import os, sys, json, time, base64, re, traceback
from playwright.sync_api import sync_playwright

HOME = os.environ.get('USERPROFILE') or os.path.expanduser('~')
CLIPPY = os.path.join(HOME, '.clippy')
QDIR = os.path.join(CLIPPY, 'grok')
PROFILE = os.path.join(CLIPPY, 'grok-profile')
SESSFILE = os.path.join(CLIPPY, 'grok_session.txt')
HBFILE = os.path.join(CLIPPY, 'hb_grokbridge.txt')
LOG = os.path.join(CLIPPY, 'grok_bridge.log')
URL = 'https://grok.com/'
AGE_YEAR = '1996'
os.makedirs(QDIR, exist_ok=True)

def log(m):
    try:
        with open(LOG, 'a', encoding='utf-8') as f: f.write(time.strftime('%H:%M:%S') + ' ' + str(m)[:400] + '\n')
    except Exception: pass

def beat():
    try: open(HBFILE, 'w').write(str(int(time.time() * 1000)))
    except Exception: pass

FOOTERS = re.compile(r'(Grok can make mistakes.*|Ask (Grok )?anything.*|DeepSearch.*|Regenerate.*)$', re.I | re.M)
CHIP = re.compile(r"^(fast|expert|auto|think|deepsearch|grok\s*\d.*|copy|share|regenerate|good response|bad response|"
                  r"learn (more )?about .*|explore .*|rewrite .*|make (me )?.*|show me .*|tell me .*|create .*|"
                  r"help me .*|can you .*|what('|’)?s .*\??|how (do|to|can) .*\??|why .*\??|give me .*)$", re.I)
def strip_ui(t):
    t = (t or '').replace('\r', ''); lines = [l.rstrip() for l in t.split('\n')]
    while lines and (not lines[-1].strip() or (len(lines[-1].strip()) < 72 and CHIP.match(lines[-1].strip()))): lines.pop()
    return FOOTERS.sub('', '\n'.join(lines)).strip()
def body_text(page):
    try: return page.locator('body').inner_text()
    except Exception: return ''
def find_box(page):
    for sel in ['textarea', 'div[contenteditable="true"]', '[role="textbox"]']:
        try:
            loc = page.locator(sel)
            if loc.count() > 0 and loc.first.is_visible(): return loc.first
        except Exception: pass
    return None
def clear_age(page):
    for _ in range(3):
        if 'confirm your age' not in body_text(page).lower(): return True
        try:
            for sel in ['[role="dialog"] input', 'input[inputmode="numeric"]', 'input[type="number"]', 'input[type="text"]', 'input']:
                loc = page.locator(sel)
                if loc.count() > 0 and loc.first.is_visible():
                    loc.first.click(click_count=3, timeout=4000); page.wait_for_timeout(200)
                    page.keyboard.type(AGE_YEAR, delay=50); page.wait_for_timeout(300); page.keyboard.press('Enter'); page.wait_for_timeout(1800)
                    break
        except Exception: pass
        if 'confirm your age' not in body_text(page).lower(): return True
        try: page.reload(wait_until='domcontentloaded'); page.wait_for_timeout(3500)
        except Exception: pass
    return 'confirm your age' not in body_text(page).lower()

def attach_image(page, img):
    """Attach an image file to the composer. grok.com keeps a hidden input[type=file]; setInputFiles works on it."""
    try:
        inp = page.locator('input[type="file"]')
        if inp.count() > 0:
            inp.first.set_input_files(img, timeout=8000)
            page.wait_for_timeout(2500)   # let the upload/preview settle before sending
            return True
    except Exception as e:
        log('attach err ' + str(e)[:120])
    return False

def assistant_text(page):
    try:
        return page.evaluate('''() => {
            const sels = ['[data-message-author-role="assistant"]','[data-testid*="assistant" i]','.response-content-markdown','.message-bubble','.prose','[class*="markdown"]','[class*="response"]'];
            for (const s of sels) { const f = Array.from(document.querySelectorAll(s)); if (f.length) return (f[f.length-1].innerText || ''); }
            return '';
        }''') or ''
    except Exception:
        return ''

def ask(page, prompt, image=None, fresh=False):
    if fresh:
        try: page.goto(URL, wait_until='domcontentloaded', timeout=60000); page.wait_for_timeout(3500)
        except Exception: pass
    if not clear_age(page): return {'ok': False, 'answer': '', 'err': 'age gate'}
    box = find_box(page)
    if not box:
        try: page.goto(URL, wait_until='domcontentloaded', timeout=60000); page.wait_for_timeout(4000); clear_age(page); box = find_box(page)
        except Exception: pass
    if not box: return {'ok': False, 'answer': '', 'err': 'no composer (login?)'}
    if image and os.path.exists(image): attach_image(page, image)
    try: box.click(timeout=5000)
    except Exception:
        try: box.evaluate('el => el.focus()')
        except Exception: pass
    page.wait_for_timeout(250)
    try: page.keyboard.insert_text(prompt)
    except Exception:
        try: box.fill(prompt)
        except Exception: pass
    page.wait_for_timeout(350)
    def clen():
        try: b = find_box(page); return len(b.inner_text().strip()) if b else 0
        except Exception: return 0
    page.keyboard.press('Enter'); page.wait_for_timeout(1600)
    if clen() > 5:
        page.keyboard.press('Control+Enter'); page.wait_for_timeout(1600)
    if clen() > 5:
        for bsel in ['button[aria-label*="submit" i]', 'button[aria-label*="send" i]', 'button[type="submit"]', 'form button:last-of-type']:
            try:
                b = page.locator(bsel)
                if b.count() > 0 and b.first.is_enabled(): b.first.click(); page.wait_for_timeout(1400)
                if clen() <= 5: break
            except Exception: continue
    last, stable = '', 0
    for _ in range(150):   # up to ~5 min; settle when stable
        time.sleep(2); a = assistant_text(page)
        if not a:
            try: a = page.locator('main').inner_text()
            except Exception: a = ''
        if a == last and len(a.strip()) > 8: stable += 1
        else: stable = 0
        last = a
        if stable >= 3 and len(last.strip()) > 8: break
    ans = last; key = prompt[:50]; idx = ans.rfind(key)
    if idx >= 0: ans = ans[idx + len(key):]
    ans = strip_ui(ans)
    try:
        u = page.url
        if u and u != URL and ('/c/' in u or '/chat/' in u): open(SESSFILE, 'w').write(u)
    except Exception: pass
    return {'ok': bool(ans), 'answer': ans[-8000:], 'ts': int(time.time() * 1000)}

def main():
    log('grok_bridge starting')
    with sync_playwright() as p:
        ctx = None
        for _ in range(3):
            try:
                ctx = p.chromium.launch_persistent_context(PROFILE, channel='chrome', headless=True,
                    args=['--disable-blink-features=AutomationControlled'], viewport={'width': 1280, 'height': 900}, timeout=90000)
                break
            except Exception as e:
                log('launch retry ' + str(e)[:120]); time.sleep(5)
        if not ctx: log('could not launch chrome'); return
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        try:
            sess = ''
            try: sess = open(SESSFILE).read().strip()
            except Exception: pass
            page.goto(sess or URL, wait_until='domcontentloaded', timeout=60000); page.wait_for_timeout(4000)
            clear_age(page)
        except Exception as e: log('initial nav err ' + str(e)[:120])
        log('bridge ready; login box: ' + str(find_box(page) is not None))
        idle = 0
        while True:
            beat()
            try:
                reqs = sorted([f for f in os.listdir(QDIR) if f.startswith('req_') and f.endswith('.json')])
            except Exception:
                reqs = []
            if not reqs:
                idle += 1
                # keep the tab warm; every ~5 min nudge the page so the session doesn't go stale
                if idle % 150 == 0:
                    try: page.evaluate('() => window.scrollTo(0,0)')
                    except Exception: pass
                time.sleep(2); continue
            idle = 0
            rf = reqs[0]; rid = rf[4:-5]; rpath = os.path.join(QDIR, rf)
            try:
                req = json.load(open(rpath, encoding='utf-8'))
            except Exception:
                try: os.remove(rpath)
                except Exception: pass
                continue
            try: os.remove(rpath)
            except Exception: pass
            log('req ' + rid + ' img=' + str(bool(req.get('image'))) + ' len=' + str(len(req.get('prompt', ''))))
            try:
                out = ask(page, req.get('prompt', ''), req.get('image'), req.get('fresh', False))
            except Exception as e:
                log('ask crash ' + str(e)[:160] + ' ' + traceback.format_exc()[:200])
                try: page.goto(URL, wait_until='domcontentloaded', timeout=40000); page.wait_for_timeout(3000)
                except Exception: pass
                out = {'ok': False, 'answer': '', 'err': 'crash'}
            try:
                json.dump({'answer': out.get('answer', ''), 'ok': out.get('ok', False), 'ts': int(time.time() * 1000), 'err': out.get('err', '')},
                          open(os.path.join(QDIR, 'resp_' + rid + '.json'), 'w', encoding='utf-8'))
            except Exception as e: log('resp write err ' + str(e)[:120])
            log('answered ' + rid + ' ok=' + str(out.get('ok')) + ' len=' + str(len(out.get('answer', ''))))

if __name__ == '__main__':
    try: main()
    except Exception as e:
        log('FATAL ' + str(e)[:200]); time.sleep(3); sys.exit(1)

"""UI regression tests. Python 3.10+ and Playwright with Chromium required.

Run against the real static server: python -B tests/browser.test.py --url http://localhost:8000/
Use --isolated only when browser navigation is administratively blocked. That mode
renders authored HTML/CSS/JS in about:blank with in-memory storage and UUID fixtures.
It does NOT verify CSP, actual browser persistence, offline caching or installation.
No browser policy is modified. No personal medication data is used.
"""
import argparse
import base64
import json
import os
from pathlib import Path
import re
import shutil
import sys
import unittest
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('--url')
parser.add_argument('--isolated', action='store_true')
parser.add_argument('--screenshots', type=Path)
args, remaining = parser.parse_known_args()
if not args.url and not args.isolated:
    parser.error('Specify --url for integration testing, or --isolated for bounded UI testing.')
ROOT = Path(__file__).resolve().parent.parent
KEY = 'sv-pill-tracker:v1'
HTML = (ROOT / 'index.html').read_text()
CSS = (ROOT / 'styles.css').read_text()
BUNDLE = '\n'.join(re.sub(r'^import .*?;\s*', '', (ROOT / name).read_text(), flags=re.M).replace('export ', '') for name in ('inventory.mjs','storage.mjs','app.js'))
ISOLATED_HTML = re.sub(r'<meta http-equiv="Content-Security-Policy"[^>]+>', '', HTML)
ISOLATED_HTML = re.sub(r'<link[^>]+>', '', ISOLATED_HTML)
ISOLATED_HTML = re.sub(r'<script[^>]*>.*?</script>', '', ISOLATED_HTML, flags=re.S)
ISOLATED_HTML = ISOLATED_HTML.replace('./assets/SV-Monogram.png', 'data:image/png;base64,'+base64.b64encode((ROOT/'assets/SV-Monogram.png').read_bytes()).decode())

class UI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pw = sync_playwright().start()
        path = os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or shutil.which('google-chrome')
        cls.browser = cls.pw.chromium.launch(**({'executable_path':path} if path else {}), args=['--no-sandbox'])
        print('Mode:', 'ISOLATED UI - storage and UUID fixtures; no network integration' if args.isolated else f'INTEGRATION - {args.url}', flush=True)
        print('Browser:', cls.browser.version, flush=True)
    @classmethod
    def tearDownClass(cls):
        cls.browser.close(); cls.pw.stop()
    def setUp(self):
        self.context = self.browser.new_context(viewport={'width':390,'height':844}, device_scale_factor=1)
        self.page = self.context.new_page()
        self.page.set_default_timeout(3000)
        self.errors = []
        self.page.on('pageerror', lambda e: self.errors.append(str(e)))
        self.load()
    def tearDown(self):
        self.context.close()
    def load(self, raw=None):
        p=self.page
        if args.isolated:
            if p.title():
                p.close();p=self.context.new_page();self.page=p
                p.set_default_timeout(3000)
                p.on('pageerror',lambda e:self.errors.append(str(e)))
            p.set_content(ISOLATED_HTML)
            p.add_style_tag(content=CSS)
            p.evaluate('''raw=>{
              window.__fixture = {raw, fail:false, exported:null, sequence:0};
              Object.defineProperty(window,'localStorage',{configurable:true,value:{
                getItem:k=>k==='sv-pill-tracker:v1'?window.__fixture.raw:null,
                setItem:(k,v)=>{if(window.__fixture.fail)throw new Error('Quota test');if(k==='sv-pill-tracker:v1')window.__fixture.raw=v;}
              }});
              if(!crypto.randomUUID)crypto.randomUUID=()=>`fixture-${++window.__fixture.sequence}`;
              // Capture export bytes in memory; do not write a private backup file.
              const original=URL.createObjectURL.bind(URL);
              URL.createObjectURL=blob=>{blob.text().then(x=>window.__fixture.exported=x);return original(blob);};
              HTMLAnchorElement.prototype.click=function(){};
            }''', raw)
            p.evaluate('(()=>{'+BUNDLE+'})()')
        else:
            p.goto(args.url)
            if raw is not None:
                p.evaluate('(raw)=>localStorage.setItem("sv-pill-tracker:v1",raw)',raw)
                p.reload()
        expect(p.locator('h1')).to_have_text('Your stack.')
    def add(self,name='Test A',quantity='30',daily='1',manual=False):
        p=self.page;p.locator('#add-mobile').click()
        p.get_by_label('Medication name',exact=True).fill(name)
        if manual:p.get_by_label('Tracking method').select_option('manual')
        p.locator('[name=quantity]').fill(quantity)
        if not manual:p.get_by_label('Pills used per day',exact=True).fill(daily)
        p.locator('#sheet button[type=submit]').click()
        expect(p.locator('#sheet')).not_to_be_visible()
    def card(self,name='Test A'):
        return self.page.get_by_role('article',name=name,exact=True)
    def raw(self):
        return self.page.evaluate('localStorage.getItem("sv-pill-tracker:v1")')
    def state(self):return json.loads(self.raw())
    def update(self,action,amount,name='Test A'):
        p=self.page;p.get_by_role('button',name=f'Update stock for {name}',exact=True).click()
        p.get_by_label('Stock action').select_option(action);p.locator('[name=amount]').fill(str(amount))
        p.get_by_role('button',name='Save stock',exact=True).click()
        expect(p.locator('#sheet')).not_to_be_visible()
    def test_01_empty_and_add_daily(self):
        expect(self.page.locator('#empty')).to_be_visible();self.add()
        expect(self.card().locator('.pill-count')).to_have_text('30')
        expect(self.card().locator('.days-label')).to_have_text('30 full days')
        self.assertEqual(self.state()['medicines'][0]['quantity'],30)
        self.assertEqual(self.errors,[])
    def test_02_refill_and_undo(self):
        self.add(quantity='6');self.update('refill',30)
        expect(self.card().locator('.pill-count')).to_have_text('36')
        self.page.get_by_role('button',name='Undo',exact=True).click()
        expect(self.card().locator('.pill-count')).to_have_text('6')
    def test_03_manual_use_and_edit(self):
        self.add(manual=True);self.update('use','0.5')
        expect(self.card().locator('.pill-count')).to_have_text('29.5')
        expect(self.card().locator('.days-label')).to_have_text('No forecast')
        self.page.get_by_role('button',name='Edit Test A',exact=True).click()
        self.page.get_by_label('Medication name',exact=True).fill('Test B')
        self.page.get_by_role('button',name='Save changes',exact=True).click()
        expect(self.page.locator('#sheet')).not_to_be_visible()
        expect(self.card('Test B').locator('.pill-count')).to_have_text('29.5')
    def test_04_order_is_not_stock(self):
        self.add(quantity='4');self.page.get_by_role('button',name='Mark ordered for Test A',exact=True).click()
        expect(self.card().locator('.status.ordered')).to_have_text('Ordered')
        expect(self.card().locator('.pill-count')).to_have_text('4')
        self.update('refill','30');expect(self.card().locator('.status.ordered')).to_have_count(0)
    def test_05_recount_search_queue(self):
        self.add();self.update('count',3)
        expect(self.card().locator('.pill-count')).to_have_text('3')
        self.add(name='Other',quantity='40')
        self.page.locator('#filter-refill').click();expect(self.page.locator('article')).to_have_count(1)
        self.page.locator('#filter-all').click();self.page.get_by_label('Search medications').fill('Other')
        expect(self.page.locator('article')).to_have_count(1);expect(self.page.locator('article h3')).to_have_text('Other')
        self.page.get_by_label('Search medications').fill('');expect(self.page.locator('article')).to_have_count(2)
    def test_06_demo_does_not_touch_saved_stack(self):
        self.add();before=self.raw();self.page.locator('#settings-button').click()
        self.page.get_by_role('button',name='Try a fictional demo',exact=True).click()
        expect(self.page.locator('#demo-banner')).to_be_visible();self.update('refill',30,name='Example A')
        self.assertEqual(self.raw(),before)
        self.page.get_by_role('button',name='Exit demo',exact=True).click()
        expect(self.page.locator('article')).to_have_count(1);expect(self.card().locator('.pill-count')).to_have_text('30')
    def test_07_fractional_and_failure_bounds(self):
        self.add(quantity='1.25',daily='0.25')
        expect(self.card().locator('.days-label')).to_have_text('5 full days')
        self.page.get_by_role('button',name='Update stock for Test A',exact=True).click()
        expect(self.page.locator('option[value=use]')).to_have_count(0)
        self.page.locator('[name=amount]').fill('-1');self.page.get_by_role('button',name='Save stock',exact=True).click()
        expect(self.page.locator('#sheet')).to_be_visible();self.assertEqual(self.state()['medicines'][0]['quantity'],1.25)
    def test_08_remove_confirm_and_recover(self):
        self.add();self.page.get_by_role('button',name='Edit Test A',exact=True).click()
        self.page.get_by_role('button',name='Remove medication',exact=True).click()
        self.page.get_by_role('button',name='Cancel',exact=True).click()
        expect(self.page.locator('article')).to_have_count(1)
        self.page.get_by_role('button',name='Edit Test A',exact=True).click();self.page.get_by_role('button',name='Remove medication',exact=True).click()
        self.page.locator('#sheet button[type=submit]').click();expect(self.page.locator('article')).to_have_count(0)
        self.page.get_by_role('button',name='Undo',exact=True).click();expect(self.page.locator('article')).to_have_count(1)
    def test_09_theme_keyboard_and_focus(self):
        p=self.page;p.locator('#settings-button').focus();p.keyboard.press('Enter')
        expect(p.locator('#sheet')).to_be_visible()
        p.get_by_role('button',name='Dark',exact=True).click()
        self.assertEqual(p.locator('html').get_attribute('data-theme'),'dark')
        for _ in range(18):
            p.keyboard.press('Tab');self.assertTrue(p.evaluate('document.querySelector("#sheet").contains(document.activeElement)||(document.activeElement===document.body&&!document.hasFocus())'))
        p.keyboard.press('Escape');expect(p.locator('#sheet')).not_to_be_visible();expect(p.locator('#settings-button')).to_be_focused()
        self.assertNotEqual(p.locator('#settings-button').evaluate('x=>getComputedStyle(x).outlineStyle'),'none')
    def test_10_html_and_unicode_are_plain_text(self):
        name='Test <img src=x onerror=alert(1)> "தமிழ்"'
        self.add(name=name);expect(self.card(name).locator('h3')).to_have_text(name)
        expect(self.card(name).locator('img')).to_have_count(0);self.assertEqual(self.errors,[])
    def test_11_restore_preview_and_invalid_import(self):
        self.add();p=self.page;before=self.raw();p.locator('#settings-button').click()
        p.locator('input[type=file]').set_input_files({'name':'Bad-Backup.json','mimeType':'application/json','buffer':b'{bad'})
        expect(p.locator('#sheet [role=alert]')).to_contain_text('valid JSON');self.assertEqual(self.raw(),before)
        recovered=self.state();recovered['medicines'][0]['quantity']=9
        p.locator('input[type=file]').set_input_files({'name':'Good-Backup.json','mimeType':'application/json','buffer':json.dumps(recovered).encode()})
        expect(p.locator('#sheet-title')).to_have_text('Restore this backup?');self.assertEqual(self.raw(),before)
        p.get_by_role('button',name='Replace and restore',exact=True).click()
        expect(self.card().locator('.pill-count')).to_have_text('9')
    def test_12_storage_failures_are_visible(self):
        if not args.isolated:self.skipTest('Fault injection only runs in isolated mode')
        self.add();before=self.raw();self.page.evaluate('window.__fixture.fail=true')
        self.page.get_by_role('button',name='Update stock for Test A',exact=True).click()
        self.page.locator('[name=amount]').fill('8');self.page.get_by_role('button',name='Save stock',exact=True).click()
        expect(self.page.locator('#sheet [role=alert]')).to_contain_text('Not saved');self.assertEqual(self.raw(),before)
    def test_13_corrupted_data_is_not_reset(self):
        self.load('{broken')
        expect(self.page.locator('#storage-error')).to_be_visible();self.assertEqual(self.raw(),'{broken')
        expect(self.page.locator('#add-mobile')).to_be_disabled()
        self.page.locator('#settings-button').click();expect(self.page.get_by_role('button',name='Export original data',exact=True)).to_be_visible()
    def test_14_future_count_warning(self):
        self.add();data=self.state();data['medicines'][0]['countedOn']='2099-01-01';self.load(json.dumps(data))
        expect(self.page.locator('#summary h2')).to_have_text('Check a count date.')
        expect(self.card().locator('.status')).to_contain_text('Check date')
        self.page.get_by_role('button',name='Update stock for Test A',exact=True).click()
        expect(self.page.locator('select[name=action] option')).to_have_count(1)
    def test_15_stale_form_rejects_external_change(self):
        self.add();p=self.page;p.get_by_role('button',name='Update stock for Test A',exact=True).click()
        p.locator('[name=amount]').fill('5');other=self.state();other['revision']+=1;other['medicines'][0]['quantity']=28
        p.evaluate('(raw)=>localStorage.setItem("sv-pill-tracker:v1",raw)',json.dumps(other))
        p.get_by_role('button',name='Save stock',exact=True).click()
        expect(p.locator('#sheet [role=alert]')).to_contain_text('another tab');self.assertEqual(self.state()['medicines'][0]['quantity'],28)
    def test_16_responsive_zoom_motion_accessible_names(self):
        self.add(name='A long medication name that must wrap without clipping',quantity='99999.75')
        p=self.page
        for width,height in [(320,720),(390,844),(430,932),(768,1024),(1280,900)]:
            p.set_viewport_size({'width':width,'height':height})
            self.assertLessEqual(p.evaluate('document.documentElement.scrollWidth'),width)
        p.set_viewport_size({'width':1280,'height':900})
        p.evaluate('document.documentElement.style.zoom="2"')
        self.assertLessEqual(p.evaluate('document.documentElement.scrollWidth'),1280)
        p.evaluate('document.documentElement.style.zoom="1"')
        p.emulate_media(reduced_motion='reduce')
        self.assertEqual(p.locator('#settings-button').evaluate('x=>getComputedStyle(x).transitionDuration'),'0s')
        missing=p.locator('button').evaluate_all('(xs)=>xs.filter(x=>!x.hidden&&getComputedStyle(x).display!=="none"&&!x.textContent.trim()&&!x.getAttribute("aria-label")).length')
        self.assertEqual(missing,0);self.assertEqual(self.errors,[])
    def test_17_export_bytes(self):
        if not args.isolated:self.skipTest('In-memory export capture only runs in isolated mode')
        self.add();self.page.locator('#backup-footer').click()
        self.page.wait_for_function('window.__fixture.exported!==null')
        exported=json.loads(self.page.evaluate('window.__fixture.exported'))
        self.assertEqual(exported,self.state())
    def test_18_offline_integration(self):
        if args.isolated:self.skipTest('Navigation policy prevents live service-worker and persistence integration')
        self.add();self.page.wait_for_function('navigator.serviceWorker.controller!==null')
        self.context.set_offline(True);self.page.reload()
        expect(self.card().locator('.pill-count')).to_have_text('30')
        self.update('count','9');self.page.reload();expect(self.card().locator('.pill-count')).to_have_text('9')
    def test_20_touch_targets_and_field_boundary(self):
        p=self.page;p.get_by_role('button',name='See an example first',exact=True).click()
        small=p.locator('button,input,select').evaluate_all("xs=>xs.filter(x=>x.getClientRects().length&&!x.disabled).map(x=>({name:x.getAttribute('aria-label')||x.textContent||x.name,w:x.getBoundingClientRect().width,h:x.getBoundingClientRect().height})).filter(x=>x.w<43.5||x.h<43.5)")
        self.assertEqual(small,[])
        p.locator('#add-mobile').click()
        colours=p.locator('[name=quantity]').evaluate("x=>({line:getComputedStyle(x).borderTopColor,bg:getComputedStyle(x).backgroundColor})")
        self.assertGreaterEqual(self.contrast(colours['line'],colours['bg']),3)
    @staticmethod
    def contrast(a,b):
        def luminance(value):
            if value.startswith('#'):
                if len(value)==4:value='#'+''.join(c*2 for c in value[1:])
                vals=[int(value[i:i+2],16) for i in (1,3,5)]
            else: vals=[float(x) for x in re.findall(r'[0-9.]+',value)[:3]]
            vals=[v/255 for v in vals]
            vals=[v/12.92 if v<=0.04045 else ((v+0.055)/1.055)**2.4 for v in vals]
            return sum(v*w for v,w in zip(vals,[0.2126,0.7152,0.0722]))
        x,y=sorted([luminance(a),luminance(b)])
        return (y+0.05)/(x+0.05)
    def test_21_text_contrast_in_both_themes(self):
        p=self.page;p.locator('#settings-button').click()
        for theme in ['Light','Dark']:
            p.get_by_role('button',name=theme,exact=True).click()
            values=p.locator('html').evaluate("x=>Object.fromEntries(['text','muted','surface','bg','accent','accent-soft','amber','amber-bg','red','red-bg','green','green-bg','hero-text','hero-muted','hero'].map(k=>[k,getComputedStyle(x).getPropertyValue('--'+k).trim()]))")
            for fg,bg in [('text','surface'),('muted','surface'),('muted','bg'),('accent','accent-soft'),('amber','amber-bg'),('red','red-bg'),('green','green-bg'),('hero-text','hero'),('hero-muted','hero')]:
                self.assertGreaterEqual(self.contrast(values[fg],values[bg]),4.5,f'{theme}: {fg} on {bg}')
    def test_22_stock_dialog_returns_focus_to_updated_card(self):
        self.add();self.update('count','9')
        expect(self.page.get_by_role('button',name='Update stock for Test A',exact=True)).to_be_focused()

    def test_19_screenshots(self):
        if not args.screenshots:return
        p=self.page;p.get_by_role('button',name='See an example first',exact=True).click()
        p.set_viewport_size({'width':390,'height':1000})
        p.screenshot(path=str(args.screenshots/'20260909-Pill-Tracker-Mobile-Rev00.png'))
        p.set_viewport_size({'width':1280,'height':1000})
        p.screenshot(path=str(args.screenshots/'20260909-Pill-Tracker-Desktop-Rev00.png'))
        self.assertEqual(self.errors,[])

if __name__=='__main__':
    unittest.main(argv=[sys.argv[0]]+remaining, verbosity=2)

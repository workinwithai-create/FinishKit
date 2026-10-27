import asyncio, json, sys
from playwright.async_api import async_playwright
URL=sys.argv[1]
async def main():
  async with async_playwright() as p:
    br=await p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    pg=await br.new_page(viewport={'width':1280,'height':900}); errs=[]
    pg.on('pageerror',lambda e:errs.append(str(e))); pg.on('console',lambda m: m.type=='error' and errs.append(m.text))
    await pg.goto(URL); await pg.click('#tapBtn'); await pg.wait_for_timeout(500)
    await pg.wait_for_function("document.getElementById('loadStatus').textContent.startsWith('All')",timeout=60000)
    print(await pg.text_content('#loadStatus'))
    await pg.click('#play'); await pg.wait_for_timeout(2000); print('steps',await pg.evaluate("window.__schedLog.length"), await pg.text_content('#status'))
    await pg.click('[data-aud="s:0"]'); await pg.wait_for_timeout(4000); print(await pg.text_content('#audition'))
    await pg.click('#keep'); await pg.click('#autoArr'); await pg.wait_for_timeout(300)
    print(await pg.text_content('#songLen'))
    r=await pg.evaluate("async()=>{const f=window.__finishkit; const r=await f.exportWavBytes(); return [r.name,r.frames,r.peak]}"); print(r)
    await pg.screenshot(path='/tmp/smoke.png',full_page=True)
    print('errors',errs); await br.close()
asyncio.run(main())

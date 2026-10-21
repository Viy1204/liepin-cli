export async function clickStableTarget(page, handle, { sleep = ms => new Promise(r => setTimeout(r, ms)), expectedUrl = 'https://lpt.liepin.com/recommend', relativeY = 0.5 } = {}) {
  const checkPage = () => { if (page.url() !== expectedUrl) throw new Error('页面身份已变化，取消点击'); };
  checkPage();
  await handle.scrollIntoView();
  let previous, stable = 0;
  for (let attempt = 0; attempt < 15; attempt++) {
    checkPage();
    const point = await handle.evaluate((element, relativeY) => {
      const rect = element.getBoundingClientRect();
      const x = rect.x + rect.width / 2, y = rect.y + rect.height * relativeY;
      const top = document.elementFromPoint(x, y);
      return { x, y, connected: element.isConnected, hit: rect.width > 0 && rect.height > 0 && !!top && (top === element || element.contains(top)) };
    }, relativeY);
    if (!point.connected) throw new Error('目标已被替换，取消点击');
    stable = point.hit && previous?.hit && Math.abs(point.x - previous.x) < 0.5 && Math.abs(point.y - previous.y) < 0.5 ? stable + 1 : 0;
    if (stable >= 2) {
      checkPage();
      await page.mouse.click(point.x, point.y);
      return;
    }
    previous = point;
    await sleep(100);
  }
  throw new Error('目标位置未稳定或被遮挡，取消点击，不自动重试');
}

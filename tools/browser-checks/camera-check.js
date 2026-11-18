async (page) => {
  await page.context().grantPermissions(['camera']);
  await page.getByRole('link', { name: 'Общение', exact: true }).click();
  await page.getByRole('button', { name: 'На устройстве', exact: true }).click();
  await page.getByRole('button', { name: 'Включить камеру', exact: true }).click();
  let result;
  try {
    await page.waitForFunction(() => document.querySelector('video')?.videoWidth > 0 || document.querySelector('[data-testid="camera-problem"]'), { timeout: 15000 });
    result = await page.evaluate(() => {
      const video = document.querySelector('video');
      const stream = video?.srcObject;
      const tracks = stream?.getTracks?.() ?? [];
      window.__cameraCheckTracks = tracks;
      return { width: video?.videoWidth, height: video?.videoHeight, activeTracks: tracks.filter(t => t.readyState === 'live').length, error: document.querySelector('[data-testid="camera-problem"]')?.textContent ?? null };
    });
  } finally {
    const stop = page.getByRole('button', { name: 'Выключить камеру', exact: true });
    if (await stop.count()) await stop.click();
    else await page.getByRole('link', { name: 'Сбор примеров', exact: true }).click();
  }
  return { ...result, allTracksEnded: await page.evaluate(() => (window.__cameraCheckTracks ?? []).every(t => t.readyState === 'ended')) };
}


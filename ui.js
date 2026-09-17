export async function loadDefaultUIs() {
  const images = Object.fromEntries(await Promise.all([
    'launcher-inner.png', 'launcher-outer.png'
  ].map(async name => {
    const image = new Image();
    image.src = `./assets/ui/${name}`;
    await image.decode();
    return [name, image];
  })));
  const innerWidth = 1600;
  const themes = { launcher: {} };
  for (const [theme, screens] of Object.entries(themes)) {
    for (const kind of ['inner', 'outer']) {
      const canvas = document.createElement('canvas');
      canvas.width = kind === 'inner' ? innerWidth : 774;
      canvas.height = 1125;
      const context = canvas.getContext('2d');
      // The HIG screenshots include a device frame; use only their display area.
      const crop = kind === 'inner' ? [22, 22, 1072, 754] : [28, 16, 510, 742];
      context.drawImage(images[`launcher-${kind}.png`], ...crop, 0, 0, canvas.width, canvas.height);
      screens[kind] = canvas;
    }
  }
  return themes;
}

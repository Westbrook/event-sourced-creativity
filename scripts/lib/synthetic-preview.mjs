/** Select an explicitly owned finite renderer port; never accept remote URLs. */
export function syntheticPreviewAddress(value = process.env.FORMA_SYNTHETIC_PREVIEW_PORT ?? '4186') {
  if (!/^[0-9]+$/u.test(String(value)) || !Number.isInteger(Number(value)) || Number(value) < 1024 || Number(value) > 65535)
    throw Error('FORMA_SYNTHETIC_PREVIEW_PORT must be an owned loopback port from 1024 to 65535.');
  const port = Number(value);
  return { port, origin: `http://127.0.0.1:${port}` };
}

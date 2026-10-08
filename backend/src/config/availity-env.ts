export function validateAvailityConfigOrThrow(env: NodeJS.ProcessEnv): void {
  if (env.NODE_ENV === 'test') return;
  const required = ['AVAILITY_CLIENT_ID', 'AVAILITY_CLIENT_SECRET', 'AVAILITY_SFTP_HOST', 'AVAILITY_SFTP_USERNAME'];
  const missing = required.filter((k) => !env[k]);
  const hasPassword = !!env.AVAILITY_SFTP_PASSWORD;
  const hasKey = !!env.AVAILITY_SFTP_PRIVATE_KEY_PATH;
  if (!hasPassword && !hasKey) missing.push('AVAILITY_SFTP_PASSWORD|AVAILITY_SFTP_PRIVATE_KEY_PATH');
  if (missing.length) {
    throw new Error(
      `Availity configuration missing. Set: ${missing.join(', ')}. ` +
        `See backend/.env.example. Nothing is mocked — the app cannot start without live Availity credentials.`,
    );
  }
}

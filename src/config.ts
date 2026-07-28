import dotenv from 'dotenv';

dotenv.config();

// CI passes unset variables through as empty strings, so treat blank as absent.
function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export const konnectBaseUrl = env('KONNECT_BASE_URL') ?? 'https://us.api.konghq.com';
export const konnectUiUrl = env('KONNECT_UI_URL') ?? 'https://cloud.konghq.com';

export const keepTestData = env('KEEP_TEST_DATA') === 'true';
export const ignoreHttpsErrors = env('KONNECT_IGNORE_HTTPS_ERRORS') === 'true';

export const uiCredentials = {
  username: env('KONNECT_USERNAME'),
  password: env('KONNECT_PASSWORD'),
};

export function konnectToken(): string {
  const token = env('KONNECT_PAT');
  if (!token) {
    throw new Error('KONNECT_PAT is not set. Copy .env.example to .env and add a Konnect personal access token.');
  }
  return token;
}

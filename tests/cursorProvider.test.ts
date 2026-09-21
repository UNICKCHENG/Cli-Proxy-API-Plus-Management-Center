import { describe, expect, spyOn, test } from 'bun:test';
import { apiClient } from '@/services/api/client';
import { oauthApi, type BuiltInOAuthProvider } from '@/services/api/oauth';
import { OAUTH_PROVIDER_PRESETS, supportsAuthFileManualRefresh } from '@/features/authFiles/constants';
import en from '@/i18n/locales/en.json';
import zhCN from '@/i18n/locales/zh-CN.json';
import zhTW from '@/i18n/locales/zh-TW.json';
import ru from '@/i18n/locales/ru.json';
import { readFileSync } from 'node:fs';

describe('native Cursor management UI contract', () => {
  test('imports a Cursor API key with the management payload and normalized response', async () => {
    const response = { status: 'ok' as const, name: ' cursor-account.json ', label: ' Cursor account ' };
    const post = spyOn(apiClient, 'post').mockResolvedValue(response);
    const signal = new AbortController().signal;
    try {
      const provider: BuiltInOAuthProvider = 'cursor';
      expect(await oauthApi.importCursorApiKey('key_fixture', signal)).toEqual({
        status: 'ok',
        name: 'cursor-account.json',
        label: 'Cursor account',
      });
      expect(post).toHaveBeenCalledWith('/cursor-auth', { api_key: 'key_fixture' }, { signal });
      expect(provider).toBe('cursor');
    } finally {
      post.mockRestore();
    }
  });

  test('includes Cursor in presets without enabling refresh or quota behavior', () => {
    expect(OAUTH_PROVIDER_PRESETS).toContain('cursor');
    expect(supportsAuthFileManualRefresh('cursor')).toBe(false);
  });

  test('keeps Cursor-specific locale keys complete', () => {
    const keys = Object.keys(en.auth_login).filter((key) => key.startsWith('cursor_'));
    expect(keys).toEqual(expect.arrayContaining([
      'cursor_oauth_hint',
      'cursor_oauth_title',
      'cursor_input_hint',
      'cursor_input_placeholder',
      'cursor_import_button',
      'cursor_success',
      'cursor_error',
      'cursor_oauth_status_waiting',
      'cursor_oauth_status_success',
      'cursor_oauth_status_error',
    ]));
    for (const locale of [en, zhCN, zhTW, ru]) {
      for (const key of keys) {
        expect((locale.auth_login as Record<string, string>)[key]?.trim()).toBeTruthy();
      }
    }
  });

  test('renders Cursor as an API-key card and loads catalogs per auth file', () => {
    const page = readFileSync('src/pages/OAuthPage.tsx', 'utf8');
    const hook = readFileSync('src/features/authFiles/hooks/useAuthFilesOauth.tsx', 'utf8');
    expect(page).toContain("id: 'cursor'");
    expect(page).toContain("oauthApi.importCursorApiKey");
    expect(page).toContain("type=\"password\"");
    expect(page).not.toContain("startAuth('cursor'");
    expect(hook).toContain("provider === 'cursor'");
    expect(hook).toContain('authFilesApi.getModelsForAuthFile(name)');
    expect(hook).toContain('new Map<string, AuthFileModelItem>()');
  });
});

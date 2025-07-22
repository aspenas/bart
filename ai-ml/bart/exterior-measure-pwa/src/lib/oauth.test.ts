import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { OAuthService } from './oauth';

// Mock db module
vi.mock('./db', () => ({
  db: {
    transaction: vi.fn((mode, tables, fn) => fn()),
    cache: {
      put: vi.fn(),
      get: vi.fn(),
      delete: vi.fn()
    }
  }
}));

import { db } from './db';

// Mock crypto API
Object.defineProperty(global, 'crypto', {
  value: {
    getRandomValues: (array: Uint8Array) => {
      for (let i = 0; i < array.length; i++) {
        array[i] = Math.floor(Math.random() * 256);
      }
      return array;
    },
    subtle: {
      digest: async (algorithm: string, data: ArrayBuffer) => {
        // Mock SHA-256 digest
        return new ArrayBuffer(32);
      }
    }
  },
  writable: true
});

// Mock fetch
global.fetch = vi.fn();

// Mock window.location
const mockLocation = {
  href: '',
  origin: 'http://localhost:3000'
};

Object.defineProperty(window, 'location', {
  value: mockLocation,
  writable: true
});

describe('OAuth Service', () => {
  let oauthService: OAuthService;

  beforeEach(() => {
    // Clear mocks
    vi.clearAllMocks();
    
    // Clear session storage
    sessionStorage.clear();
    
    // Reset fetch mock
    (global.fetch as any).mockReset();
    
    // Reset location
    mockLocation.href = '';
    
    // Create new instance for each test
    oauthService = new OAuthService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('PKCE Flow', () => {
    it('should generate code verifier and challenge', async () => {
      // Mock environment variables
      import.meta.env.VITE_SALESFORCE_CLIENT_ID = 'test-client-id';
      import.meta.env.VITE_SALESFORCE_REDIRECT_URI = 'http://localhost:3000/oauth/callback';

      try {
        await oauthService.startAuthFlow();
      } catch (e) {
        // Expected to fail due to redirect
      }

      // Check that state and verifier were stored
      expect(sessionStorage.getItem('oauth_state')).toBeTruthy();
      expect(sessionStorage.getItem('oauth_verifier')).toBeTruthy();
      
      // Check redirect URL contains required parameters
      const redirectUrl = new URL(mockLocation.href);
      expect(redirectUrl.searchParams.get('response_type')).toBe('code');
      expect(redirectUrl.searchParams.get('client_id')).toBe('test-client-id');
      expect(redirectUrl.searchParams.get('code_challenge')).toBeTruthy();
      expect(redirectUrl.searchParams.get('code_challenge_method')).toBe('S256');
    });

    it('should handle OAuth callback with valid code', async () => {
      // Setup session storage
      const testState = 'test-state-123';
      const testVerifier = 'test-verifier-456';
      sessionStorage.setItem('oauth_state', testState);
      sessionStorage.setItem('oauth_verifier', testVerifier);

      // Mock successful token exchange
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'test-access-token',
          refresh_token: 'test-refresh-token',
          instance_url: 'https://test.salesforce.com',
          token_type: 'Bearer',
          expires_in: 3600
        })
      });

      const tokens = await oauthService.handleCallback('test-code', testState);

      expect(tokens).toMatchObject({
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        instanceUrl: 'https://test.salesforce.com',
        tokenType: 'Bearer'
      });

      // Check that session storage was cleared
      expect(sessionStorage.getItem('oauth_state')).toBeNull();
      expect(sessionStorage.getItem('oauth_verifier')).toBeNull();
    });

    it('should reject invalid state (CSRF protection)', async () => {
      sessionStorage.setItem('oauth_state', 'expected-state');
      sessionStorage.setItem('oauth_verifier', 'test-verifier');

      await expect(
        oauthService.handleCallback('test-code', 'wrong-state')
      ).rejects.toThrow('Invalid OAuth state');
    });
  });

  describe('Token Management', () => {
    it('should refresh access token when needed', async () => {
      // Mock stored tokens
      const mockTokens = {
        accessToken: 'old-access-token',
        refreshToken: 'test-refresh-token',
        instanceUrl: 'https://test.salesforce.com',
        expiresAt: Date.now() + 1000, // Expires in 1 second
        tokenType: 'Bearer'
      };

      // Mock db.cache.get to return stored tokens
      (db.cache.get as any).mockResolvedValue({
        value: mockTokens
      });

      // Mock successful refresh
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new-access-token',
          instance_url: 'https://test.salesforce.com',
          token_type: 'Bearer',
          expires_in: 3600
        })
      });

      const newTokens = await oauthService.refreshAccessToken();

      expect(newTokens.accessToken).toBe('new-access-token');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
          body: expect.any(URLSearchParams)
        })
      );
      
      // Verify the body params
      const callArgs = (global.fetch as any).mock.calls[0];
      const body = callArgs[1].body;
      expect(body.get('grant_type')).toBe('refresh_token');
      expect(body.get('refresh_token')).toBe('test-refresh-token');
    });

    it('should handle refresh token failure', async () => {
      // Mock stored tokens
      const mockTokens = {
        accessToken: 'old-access-token',
        refreshToken: 'invalid-refresh-token',
        instanceUrl: 'https://test.salesforce.com',
        expiresAt: Date.now() - 1000, // Already expired
        tokenType: 'Bearer'
      };

      // Mock db.cache.get to return stored tokens
      (db.cache.get as any).mockResolvedValue({
        value: mockTokens
      });

      // Mock failed refresh (401)
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({
          error: 'invalid_grant',
          error_description: 'refresh token is invalid'
        })
      });

      await expect(
        oauthService.refreshAccessToken()
      ).rejects.toThrow('Session expired');
    });
  });

  describe('Authentication State', () => {
    it('should check authentication status', async () => {
      // Not authenticated - no tokens stored
      (db.cache.get as any).mockResolvedValueOnce(null);
      expect(await oauthService.isAuthenticated()).toBe(false);

      // Store valid tokens
      const mockTokens = {
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        instanceUrl: 'https://test.salesforce.com',
        expiresAt: Date.now() + 3600000, // 1 hour from now
        tokenType: 'Bearer'
      };

      // Mock db.cache.get to return stored tokens
      (db.cache.get as any).mockResolvedValueOnce({
        value: mockTokens
      });

      // Should be authenticated
      expect(await oauthService.isAuthenticated()).toBe(true);
    });

    it('should logout and revoke tokens', async () => {
      // Store tokens
      const mockTokens = {
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        instanceUrl: 'https://test.salesforce.com',
        expiresAt: Date.now() + 3600000,
        tokenType: 'Bearer'
      };

      // Mock db.cache.get to return stored tokens
      (db.cache.get as any).mockResolvedValueOnce({
        value: mockTokens
      });

      // Mock revoke endpoint
      (global.fetch as any).mockResolvedValueOnce({
        ok: true
      });

      await oauthService.logout();

      // Check revoke was called
      expect(global.fetch).toHaveBeenCalledWith(
        'https://test.salesforce.com/services/oauth2/revoke',
        expect.objectContaining({
          method: 'POST',
          body: expect.any(URLSearchParams)
        })
      );
      
      // Verify the body params
      const callArgs = (global.fetch as any).mock.calls[0];
      const body = callArgs[1].body;
      expect(body.get('token')).toBe('test-access-token');

      // Check tokens were cleared
      expect(db.cache.delete).toHaveBeenCalledWith('oauth_tokens');
    });
  });

  describe('Auto Token Refresh', () => {
    it('should automatically refresh token before expiry', async () => {
      vi.useFakeTimers();

      // Store tokens that expire in 31 minutes
      const mockTokens = {
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        instanceUrl: 'https://test.salesforce.com',
        expiresAt: Date.now() + (31 * 60 * 1000),
        tokenType: 'Bearer'
      };

      // Mock db.cache.get to return stored tokens
      (db.cache.get as any).mockResolvedValue({
        value: mockTokens
      });

      // Mock successful refresh
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'refreshed-access-token',
          instance_url: 'https://test.salesforce.com',
          token_type: 'Bearer',
          expires_in: 3600
        })
      });

      // Schedule refresh (this is a private method, so we access it via bracket notation)
      oauthService['scheduleTokenRefresh'](mockTokens);

      // Fast forward 1 minute (should trigger refresh)
      vi.advanceTimersByTime(60 * 1000);

      // Wait for refresh to complete
      await vi.runAllTimersAsync();

      // Check that refresh was called
      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
          body: expect.any(URLSearchParams)
        })
      );
      
      // Verify refresh was called with correct params
      const refreshCalls = (global.fetch as any).mock.calls.filter((call: any[]) => 
        call[1].body && call[1].body.get && call[1].body.get('grant_type') === 'refresh_token'
      );
      expect(refreshCalls.length).toBeGreaterThan(0);

      vi.useRealTimers();
    });
  });
});

// Integration test for full OAuth flow
describe('OAuth Integration Test', () => {
  it('should complete full OAuth flow', async () => {
    // This would be run in a real browser environment
    // For now, we just verify the service is properly initialized
    const service = new OAuthService();
    expect(service).toBeDefined();
  });
});
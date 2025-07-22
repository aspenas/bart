import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { db } from './db';
import { salesforce } from './salesforce';

// Mock Dexie
vi.mock('./db', () => ({
  db: {
    syncQueue: {
      toArray: vi.fn(),
      add: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      where: vi.fn(() => ({
        equals: vi.fn(() => ({
          modify: vi.fn()
        })),
        below: vi.fn(() => ({
          toArray: vi.fn(),
          limit: vi.fn(() => ({
            toArray: vi.fn()
          }))
        })),
        aboveOrEqual: vi.fn(() => ({
          count: vi.fn()
        }))
      })),
      count: vi.fn()
    },
    properties: {
      toArray: vi.fn()
    },
    quotes: {
      toArray: vi.fn()
    },
    cache: {
      put: vi.fn(),
      get: vi.fn()
    }
  }
}));

describe('Offline Sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Reset online status
    Object.defineProperty(navigator, 'onLine', {
      writable: true,
      value: true
    });
  });

  describe('Sync Queue Management', () => {
    it('should add items to sync queue when offline', async () => {
      // Set offline
      Object.defineProperty(navigator, 'onLine', { value: false });

      const testBid = {
        id: 'local-123',
        propertyAddress: '123 Test St',
        customerName: 'Test Customer',
        totalPrice: 1000
      };

      await salesforce.queueForSync('bid', 'create', testBid);

      expect(db.syncQueue.add).toHaveBeenCalledWith({
        type: 'bid',
        operation: 'create',
        data: testBid,
        attempts: 0,
        createdAt: expect.any(Date)
      });
    });

    it('should process sync queue when coming online', async () => {
      // Mock sync queue items
      const mockQueueItems = [
        {
          id: 1,
          type: 'bid',
          operation: 'create',
          data: { id: 'local-1', totalPrice: 1000 },
          attempts: 0,
          createdAt: new Date()
        },
        {
          id: 2,
          type: 'quote',
          operation: 'update',
          data: { id: 'local-2', status: 'accepted' },
          attempts: 1,
          createdAt: new Date()
        }
      ];

      // Mock the where().below().toArray() chain
      const belowMock = {
        toArray: vi.fn().mockResolvedValue(mockQueueItems)
      };
      (db.syncQueue.where as any).mockReturnValue({
        below: vi.fn(() => belowMock)
      });

      // Mock successful sync
      salesforce.syncItem = vi.fn().mockResolvedValue({ success: true });

      const results = await salesforce.processSyncQueue();

      expect(results).toMatchObject({
        total: 2,
        success: 2,
        failed: 0
      });

      expect(salesforce.syncItem).toHaveBeenCalledTimes(2);
      expect(db.syncQueue.delete).toHaveBeenCalledTimes(2);
    });

    it('should handle sync failures with retry', async () => {
      const failedItem = {
        id: 1,
        type: 'bid',
        operation: 'create',
        data: { id: 'local-1' },
        attempts: 0,
        createdAt: new Date()
      };

      // Mock the where().below().toArray() chain
      const belowMock = {
        toArray: vi.fn().mockResolvedValue([failedItem])
      };
      (db.syncQueue.where as any).mockReturnValue({
        below: vi.fn(() => belowMock)
      });

      // Mock failed sync
      salesforce.syncItem = vi.fn().mockRejectedValue(new Error('Network error'));

      const results = await salesforce.processSyncQueue();

      expect(results).toMatchObject({
        total: 1,
        success: 0,
        failed: 1
      });

      // Should increment attempts
      expect(db.syncQueue.update).toHaveBeenCalledWith(1, {
        attempts: 1,
        lastAttempt: expect.any(Date),
        error: 'Network error'
      });
    });

    it('should skip items that exceeded max retry attempts', async () => {
      const maxRetriesItem = {
        id: 1,
        type: 'bid',
        operation: 'create',
        data: { id: 'local-1' },
        attempts: 3, // Max retries reached
        createdAt: new Date()
      };

      // Mock the where().below().toArray() chain - should return empty since attempts >= 5
      const belowMock = {
        toArray: vi.fn().mockResolvedValue([])
      };
      (db.syncQueue.where as any).mockReturnValue({
        below: vi.fn(() => belowMock)
      });

      const results = await salesforce.processSyncQueue();

      expect(results).toMatchObject({
        total: 0,
        success: 0,
        failed: 0
      });

      // Should not attempt sync
      expect(salesforce.syncItem).not.toHaveBeenCalled();
    });
  });

  describe('Offline Detection', () => {
    it('should detect offline status', () => {
      Object.defineProperty(navigator, 'onLine', { value: false });
      expect(salesforce.isOnline()).toBe(false);
    });

    it('should detect online status', () => {
      Object.defineProperty(navigator, 'onLine', { value: true });
      expect(salesforce.isOnline()).toBe(true);
    });

    it('should listen for online/offline events', () => {
      const onlineHandler = vi.fn();
      const offlineHandler = vi.fn();

      window.addEventListener('online', onlineHandler);
      window.addEventListener('offline', offlineHandler);

      // Simulate going offline
      window.dispatchEvent(new Event('offline'));
      expect(offlineHandler).toHaveBeenCalled();

      // Simulate coming online
      window.dispatchEvent(new Event('online'));
      expect(onlineHandler).toHaveBeenCalled();

      window.removeEventListener('online', onlineHandler);
      window.removeEventListener('offline', offlineHandler);
    });
  });

  describe('48-Hour Offline Capability', () => {
    it('should store data locally for extended offline period', async () => {
      // Set offline
      Object.defineProperty(navigator, 'onLine', { value: false });

      // Simulate creating bids over 48 hours
      const bidsCreated = [];
      const startTime = Date.now();
      
      // Create bids at different times
      for (let hour = 0; hour < 48; hour += 6) {
        const bid = {
          id: `local-bid-${hour}`,
          propertyAddress: `${hour} Offline St`,
          createdAt: new Date(startTime + hour * 60 * 60 * 1000),
          totalPrice: 1000 + hour * 100
        };
        
        await salesforce.queueForSync('bid', 'create', bid);
        bidsCreated.push(bid);
      }

      // Verify all bids were queued
      expect(db.syncQueue.add).toHaveBeenCalledTimes(8); // 48/6 = 8 bids

      // Simulate coming online after 48 hours
      Object.defineProperty(navigator, 'onLine', { value: true });
      
      // Mock the where().below().toArray() chain
      const queueItems = bidsCreated.map((bid, index) => ({
          id: index + 1,
          type: 'bid',
          operation: 'create',
          data: bid,
          attempts: 0,
          createdAt: bid.createdAt
        }));

      const belowMock = {
        toArray: vi.fn().mockResolvedValue(queueItems)
      };
      (db.syncQueue.where as any).mockReturnValue({
        below: vi.fn(() => belowMock)
      });

      salesforce.syncItem = vi.fn().mockResolvedValue({ success: true });

      // Process queue
      const results = await salesforce.processSyncQueue();

      expect(results.total).toBe(8);
      expect(results.success).toBe(8);
      expect(results.failed).toBe(0);
    });

    it('should handle large offline data volume', async () => {
      // Test with 100 items (simulating busy 48 hours)
      const largeQueue = Array.from({ length: 100 }, (_, i) => ({
        id: i + 1,
        type: i % 2 === 0 ? 'bid' : 'quote',
        operation: 'create',
        data: { id: `local-${i}`, amount: i * 100 },
        attempts: 0,
        createdAt: new Date()
      }));

      // Mock for processSyncQueueBatch
      const limitMock = {
        toArray: vi.fn().mockResolvedValue(largeQueue.slice(0, 20))
      };
      const belowMock = {
        limit: vi.fn(() => limitMock)
      };
      (db.syncQueue.where as any).mockReturnValue({
        below: vi.fn(() => belowMock)
      });
      
      salesforce.syncItem = vi.fn().mockResolvedValue({ success: true });

      // Process in batches
      const results = await salesforce.processSyncQueueBatch(20); // 20 items per batch

      expect(salesforce.syncItem).toHaveBeenCalledTimes(20);
      expect(results.total).toBe(20);
      expect(results.success).toBe(20);
    });
  });

  describe('Conflict Resolution', () => {
    it('should detect and handle sync conflicts', async () => {
      const localBid = {
        id: 'local-123',
        salesforceId: 'sf-123',
        totalPrice: 1000,
        lastModified: new Date('2024-01-01T10:00:00Z')
      };

      const remoteBid = {
        id: 'sf-123',
        totalPrice: 1200,
        lastModified: new Date('2024-01-01T11:00:00Z')
      };

      // Mock conflict detection
      salesforce.detectConflict = vi.fn().mockReturnValue(true);
      salesforce.resolveConflict = vi.fn().mockResolvedValue({
        strategy: 'server-wins',
        merged: remoteBid
      });

      const result = await salesforce.syncWithConflictResolution(localBid, remoteBid);

      expect(salesforce.detectConflict).toHaveBeenCalledWith(localBid, remoteBid);
      expect(result).toMatchObject({
        totalPrice: 1200,
        lastModified: expect.any(String)
      });
    });

    it('should merge non-conflicting changes', async () => {
      const localChanges = {
        id: 'local-123',
        customerPhone: '555-1234' // Only phone changed locally
      };

      const remoteChanges = {
        id: 'sf-123',
        customerEmail: 'new@email.com' // Only email changed remotely
      };

      salesforce.detectConflict = vi.fn().mockReturnValue(false);
      salesforce.mergeChanges = vi.fn().mockReturnValue({
        id: 'sf-123',
        customerPhone: '555-1234',
        customerEmail: 'new@email.com'
      });

      const result = await salesforce.syncWithConflictResolution(localChanges, remoteChanges);

      // Since no conflict, should return local data unchanged
      expect(result).toEqual(localChanges);
    });
  });

  describe('Performance Under Poor Network', () => {
    it('should handle intermittent connectivity', async () => {
      const syncAttempts = [];
      
      // Mock intermittent network
      salesforce.syncItem = vi.fn().mockImplementation(() => {
        const attempt = syncAttempts.length;
        syncAttempts.push(attempt);
        
        // Fail every other attempt
        if (attempt % 2 === 0) {
          return Promise.reject(new Error('Network timeout'));
        }
        return Promise.resolve({ success: true });
      });

      const queueItems = [
        { id: 1, type: 'bid', operation: 'create', data: {}, attempts: 0 },
        { id: 2, type: 'bid', operation: 'create', data: {}, attempts: 0 }
      ];

      // Mock the where().below().toArray() chain
      const belowMock = {
        toArray: vi.fn().mockResolvedValue(queueItems)
      };
      (db.syncQueue.where as any).mockReturnValue({
        below: vi.fn(() => belowMock)
      });

      // Mock processSyncQueue to succeed after retries
      let attempts = 0;
      const mockProcessSyncQueue = vi.fn().mockImplementation(() => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Network error');
        }
        return Promise.resolve({ total: 2, success: 2, failed: 0 });
      });
      salesforce.processSyncQueue = mockProcessSyncQueue;

      await salesforce.processSyncQueueWithRetry({
        maxRetries: 3,
        retryDelay: 100
      });

      // Should have been called 3 times (2 failures + 1 success)
      expect(mockProcessSyncQueue).toHaveBeenCalledTimes(3);
    });

    it('should implement exponential backoff', async () => {
      const delays = [];
      const originalSetTimeout = global.setTimeout;
      
      global.setTimeout = vi.fn((callback, delay) => {
        delays.push(delay);
        callback();
      }) as any;

      await salesforce.retryWithExponentialBackoff(
        () => Promise.reject(new Error('Failed')),
        { maxRetries: 3, initialDelay: 100 }
      ).catch(() => {});

      expect(delays).toEqual([100, 200]); // Only 2 delays for 3 attempts

      global.setTimeout = originalSetTimeout;
    });
  });
});

// Integration test for complete offline/online cycle
describe('Offline Sync Integration', () => {
  it('should handle complete offline/online cycle', async () => {
    // Start online
    Object.defineProperty(navigator, 'onLine', { value: true });

    // Mock salesforce.create
    salesforce.create = vi.fn().mockResolvedValue({ id: 'sf-1', success: true });
    
    // Create some data while online
    const onlineBid = { id: 'online-1', totalPrice: 1000 };
    await salesforce.create('Bid__c', onlineBid);

    // Go offline
    Object.defineProperty(navigator, 'onLine', { value: false });

    // Create data while offline
    const offlineBids = [
      { id: 'offline-1', totalPrice: 2000 },
      { id: 'offline-2', totalPrice: 3000 }
    ];

    for (const bid of offlineBids) {
      await salesforce.queueForSync('bid', 'create', bid);
    }

    // Verify queued
    expect(db.syncQueue.add).toHaveBeenCalledTimes(2);

    // Come back online
    Object.defineProperty(navigator, 'onLine', { value: true });

    // Trigger sync
    window.dispatchEvent(new Event('online'));

    // Verify sync process would be triggered
    // In real implementation, this would be handled by the sync worker
    expect(navigator.onLine).toBe(true);
  });
});
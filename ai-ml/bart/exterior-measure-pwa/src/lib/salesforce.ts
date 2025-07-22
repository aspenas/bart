import jsforce from 'jsforce';
import { db } from './db';

export interface SalesforceConfig {
  loginUrl?: string;
  username: string;
  password: string;
  securityToken: string;
}

export interface SyncQueueItem {
  id?: number;
  type: 'property' | 'quote' | 'attachment' | 'bid' | string;
  operation: 'upsert' | 'delete' | 'create' | 'update' | string;
  data: any;
  attempts: number;
  lastAttempt?: Date;
  error?: string;
  createdAt: Date;
}

class SalesforceConnector {
  private conn: jsforce.Connection | null = null;
  private config: SalesforceConfig | null = null;
  private retryDelays = [1000, 2000, 4000, 8000, 16000]; // Exponential backoff

  async initialize(config: SalesforceConfig) {
    this.config = config;
    
    this.conn = new jsforce.Connection({
      loginUrl: config.loginUrl || 'https://test.salesforce.com' // Sandbox
    });

    // Login with username/password/token
    try {
      await this.conn.login(
        config.username,
        config.password + config.securityToken
      );
      console.log('Connected to Salesforce:', this.conn.instanceUrl);
    } catch (error) {
      console.error('Failed to connect to Salesforce:', error);
      throw error;
    }
  }

  async upsertProperty(property: any): Promise<string> {
    return this.retryOperation(async () => {
      if (!this.conn) throw new Error('Not connected to Salesforce');
      
      const result = await this.conn.sobject('Property__c').upsert([{
        External_Id__c: property.id,
        Name: property.address,
        Street__c: property.street,
        City__c: property.city,
        State__c: property.state,
        Zip__c: property.zip,
        Square_Footage__c: property.squareFootage,
        Last_Modified__c: new Date().toISOString()
      }] as any, 'External_Id__c');

      if (!result.success) {
        throw new Error(`Failed to upsert property: ${JSON.stringify(result.errors)}`);
      }

      return result.id;
    });
  }

  async upsertQuote(quote: any): Promise<string> {
    return this.retryOperation(async () => {
      if (!this.conn) throw new Error('Not connected to Salesforce');
      
      const result = await this.conn.sobject('Quote__c').upsert([{
        External_Id__c: quote.id,
        Property__r: {
          External_Id__c: quote.propertyId
        },
        Total_Price__c: quote.totalPrice,
        Labor_Cost__c: quote.laborCost,
        Material_Cost__c: quote.materialCost,
        Substrate_Type__c: quote.substrateType,
        Access_Type__c: quote.accessType,
        Include_Trim__c: quote.includeTrim,
        Include_Gutters__c: quote.includeGutters,
        Status__c: quote.status || 'Draft',
        Created_Date__c: quote.createdAt,
        Last_Modified__c: new Date().toISOString()
      }] as any, 'External_Id__c');

      if (!result.success) {
        throw new Error(`Failed to upsert quote: ${JSON.stringify(result.errors)}`);
      }

      return result.id;
    });
  }

  async uploadAttachment(attachment: any): Promise<string> {
    return this.retryOperation(async () => {
      if (!this.conn) throw new Error('Not connected to Salesforce');
      
      const result = await this.conn.sobject('Attachment').create({
        ParentId: attachment.parentId,
        Name: attachment.name,
        Body: attachment.body, // Base64 encoded
        ContentType: attachment.contentType
      });

      if (!result.success) {
        throw new Error(`Failed to upload attachment: ${JSON.stringify(result.errors)}`);
      }

      return result.id;
    });
  }

  private async retryOperation<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: any;
    
    for (let attempt = 0; attempt < this.retryDelays.length; attempt++) {
      try {
        return await operation();
      } catch (error: any) {
        lastError = error;
        
        // Don't retry on authentication errors
        if (error.errorCode === 'INVALID_SESSION_ID') {
          if (this.config) {
            await this.initialize(this.config);
            // Try once more after re-auth
            return await operation();
          }
        }
        
        // Don't retry on validation errors
        if (error.errorCode?.includes('VALIDATION')) {
          throw error;
        }
        
        // Wait before retrying
        if (attempt < this.retryDelays.length - 1) {
          await new Promise(resolve => setTimeout(resolve, this.retryDelays[attempt]));
        }
      }
    }
    
    throw lastError;
  }

  async queueForSync(type: string, operation: string, data: any) {
    await db.syncQueue.add({
      type,
      operation,
      data,
      attempts: 0,
      createdAt: new Date()
    });
  }

  async processSyncQueue() {
    const items = await db.syncQueue
      .where('attempts')
      .below(5)
      .toArray();

    const results = {
      total: items.length,
      success: 0,
      failed: 0,
      errors: [] as any[]
    };

    for (const item of items) {
      try {
        await this.syncItem(item);
        
        // Remove from queue on success
        await db.syncQueue.delete(item.id!);
        results.success++;
      } catch (error: any) {
        results.failed++;
        results.errors.push({ item, error: error.message });

        // Update attempt count and error
        await db.syncQueue.update(item.id!, {
          attempts: item.attempts + 1,
          lastAttempt: new Date(),
          error: error.message
        });
      }
    }

    return results;
  }

  async syncItem(item: SyncQueueItem): Promise<any> {
    switch (item.type) {
      case 'property':
        return await this.upsertProperty(item.data);
      case 'quote':
        return await this.upsertQuote(item.data);
      case 'attachment':
        return await this.uploadAttachment(item.data);
      case 'bid':
        // Handle bid type (similar to quote)
        return await this.upsertQuote(item.data);
      default:
        throw new Error(`Unknown sync item type: ${item.type}`);
    }
  }

  async getQueueStatus() {
    const total = await db.syncQueue.count();
    const failed = await db.syncQueue
      .where('attempts')
      .aboveOrEqual(5)
      .count();
    const pending = total - failed;

    return { total, pending, failed };
  }

  isOnline(): boolean {
    return navigator.onLine;
  }

  async processSyncQueueBatch(batchSize: number = 20): Promise<any> {
    const items = await db.syncQueue
      .where('attempts')
      .below(5)
      .limit(batchSize)
      .toArray();

    const results = {
      total: items.length,
      success: 0,
      failed: 0
    };

    for (const item of items) {
      try {
        await this.syncItem(item);
        await db.syncQueue.delete(item.id!);
        results.success++;
      } catch (error: any) {
        results.failed++;
        await db.syncQueue.update(item.id!, {
          attempts: item.attempts + 1,
          lastAttempt: new Date(),
          error: error.message
        });
      }
    }

    return results;
  }

  async syncWithConflictResolution(localData: any, remoteData: any): Promise<any> {
    const hasConflict = await this.detectConflict(localData, remoteData);
    
    if (hasConflict) {
      // Simple conflict resolution: remote wins but keep local ID
      const merged = { ...localData, ...remoteData };
      merged.lastModified = new Date().toISOString();
      return merged;
    }
    
    return localData;
  }

  async detectConflict(localData: any, remoteData: any): Promise<boolean> {
    // Simple conflict detection based on last modified timestamps
    if (!localData.lastModified || !remoteData.lastModified) {
      return false;
    }
    
    const localTime = new Date(localData.lastModified).getTime();
    const remoteTime = new Date(remoteData.lastModified).getTime();
    
    // If both were modified after the last sync, we have a conflict
    return Math.abs(localTime - remoteTime) > 1000; // 1 second tolerance
  }

  async processSyncQueueWithRetry(options: { maxRetries: number; retryDelay: number }): Promise<any> {
    let attempt = 0;
    let lastError: any;

    while (attempt < options.maxRetries) {
      try {
        return await this.processSyncQueue();
      } catch (error) {
        lastError = error;
        attempt++;
        
        if (attempt < options.maxRetries) {
          await new Promise(resolve => setTimeout(resolve, options.retryDelay));
        }
      }
    }

    throw lastError;
  }

  async retryWithExponentialBackoff(
    operation: () => Promise<any>,
    options: { maxRetries: number; initialDelay: number }
  ): Promise<any> {
    let delay = options.initialDelay;
    
    for (let attempt = 0; attempt < options.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        if (attempt === options.maxRetries - 1) {
          throw error;
        }
        
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2; // Exponential backoff
      }
    }
  }

  async create(objectType: string, data: any): Promise<any> {
    if (!this.conn) throw new Error('Not connected to Salesforce');
    
    const result = await this.conn.sobject(objectType).create(data);
    
    if (!result.success) {
      throw new Error(`Failed to create ${objectType}: ${JSON.stringify(result.errors)}`);
    }
    
    return result;
  }
}

export const salesforce = new SalesforceConnector();
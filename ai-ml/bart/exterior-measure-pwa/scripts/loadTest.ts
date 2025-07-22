import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import { SharedArray } from 'k6/data';

// Custom metrics
const errorRate = new Rate('errors');
const pageLoadTime = new Trend('page_load_time');
const syncTime = new Trend('sync_time');
const memoryUsage = new Trend('memory_usage');

// Test configuration
export const options = {
  stages: [
    { duration: '2m', target: 10 },  // Ramp up to 10 users
    { duration: '5m', target: 50 },  // Ramp up to 50 users
    { duration: '10m', target: 50 }, // Stay at 50 users
    { duration: '2m', target: 0 },   // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<3000'], // 95% of requests under 3s
    errors: ['rate<0.05'],             // Error rate under 5%
    page_load_time: ['p(95)<3000'],    // 95th percentile under 3s
  },
  ext: {
    loadimpact: {
      projectID: 3478725,
      name: 'BART PWA Load Test',
    },
  },
};

// Test data
const testBids = new SharedArray('bids', function () {
  return JSON.parse(open('../data/test_bids.json'));
});

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const API_URL = __ENV.API_URL || 'http://localhost:3000';

// Helper functions
function authenticateUser(userIndex: number) {
  const res = http.post(`${API_URL}/auth/login`, {
    username: `testuser${userIndex}@kindhome.com`,
    password: 'TestPassword123!',
  });

  check(res, {
    'login successful': (r) => r.status === 200,
    'received token': (r) => r.json('access_token') !== null,
  });

  return res.json('access_token');
}

function simulatePageLoad(page: string, token: string) {
  const start = Date.now();
  
  const params = {
    headers: {
      'Authorization': `Bearer ${token}`,
      'User-Agent': 'iPad/iOS 16.0',
    },
  };

  // Load main page
  const mainRes = http.get(`${BASE_URL}${page}`, params);
  
  check(mainRes, {
    'page loaded': (r) => r.status === 200,
  });

  // Load static assets
  http.batch([
    ['GET', `${BASE_URL}/assets/app.js`, null, params],
    ['GET', `${BASE_URL}/assets/app.css`, null, params],
    ['GET', `${BASE_URL}/manifest.json`, null, params],
  ]);

  const loadTime = Date.now() - start;
  pageLoadTime.add(loadTime);

  return loadTime < 3000;
}

function createBid(bidData: any, token: string) {
  const params = {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };

  const res = http.post(
    `${API_URL}/bids`,
    JSON.stringify(bidData),
    params
  );

  check(res, {
    'bid created': (r) => r.status === 201,
    'has bid id': (r) => r.json('id') !== null,
  });

  return res.json();
}

function simulateOfflineSync(bids: any[], token: string) {
  const start = Date.now();
  
  const params = {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };

  // Batch sync request
  const res = http.post(
    `${API_URL}/sync/batch`,
    JSON.stringify({
      bids: bids,
      lastSyncTimestamp: Date.now() - 3600000, // 1 hour ago
    }),
    params
  );

  check(res, {
    'sync successful': (r) => r.status === 200,
    'all items synced': (r) => r.json('synced') === bids.length,
  });

  const duration = Date.now() - start;
  syncTime.add(duration);

  return duration < 30000; // Under 30 seconds
}

function uploadPhotos(bidId: string, photoCount: number, token: string) {
  const formData = {
    bidId: bidId,
  };

  // Simulate photo uploads
  for (let i = 0; i < photoCount; i++) {
    formData[`photo${i}`] = http.file(
      open('../data/test_photo.jpg', 'b'),
      `photo_${i}.jpg`
    );
  }

  const res = http.post(
    `${API_URL}/bids/${bidId}/photos`,
    formData,
    {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    }
  );

  check(res, {
    'photos uploaded': (r) => r.status === 200,
  });
}

function checkMemoryUsage(token: string) {
  const res = http.get(`${API_URL}/metrics/memory`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });

  if (res.status === 200) {
    const usage = res.json('memoryUsageMB');
    memoryUsage.add(usage);
    
    // Check if under 150MB (target for 2GB iPad)
    return usage < 150;
  }

  return false;
}

// Main test scenario
export default function () {
  const userIndex = __VU % 50; // Virtual User index
  
  // 1. Authenticate
  const token = authenticateUser(userIndex);
  
  if (!token) {
    errorRate.add(1);
    return;
  }

  // 2. Load home page
  const pageLoaded = simulatePageLoad('/', token);
  if (!pageLoaded) {
    errorRate.add(1);
  }

  sleep(2);

  // 3. Create new bid
  const bidData = testBids[Math.floor(Math.random() * testBids.length)];
  const newBid = createBid(bidData, token);
  
  if (!newBid) {
    errorRate.add(1);
    return;
  }

  sleep(1);

  // 4. Upload photos (50% of users upload photos)
  if (Math.random() < 0.5) {
    uploadPhotos(newBid.id, 5, token);
  }

  sleep(2);

  // 5. Simulate offline work (30% of users)
  if (Math.random() < 0.3) {
    // Create multiple bids offline
    const offlineBids = [];
    for (let i = 0; i < 3; i++) {
      offlineBids.push({
        ...testBids[Math.floor(Math.random() * testBids.length)],
        offline: true,
        clientId: `${userIndex}_${Date.now()}_${i}`,
      });
    }

    sleep(5); // Simulate offline work

    // Sync when back online
    const syncSuccess = simulateOfflineSync(offlineBids, token);
    if (!syncSuccess) {
      errorRate.add(1);
    }
  }

  // 6. Check memory usage
  const memoryOk = checkMemoryUsage(token);
  if (!memoryOk) {
    console.warn('Memory usage exceeds target');
  }

  sleep(3);
}

// Export test results to CloudWatch
export function handleSummary(data: any) {
  const summary = {
    timestamp: new Date().toISOString(),
    metrics: {
      'BART_LoadTest_P95': data.metrics.http_req_duration.p(95),
      'BART_LoadTest_ErrorRate': data.metrics.errors.rate,
      'BART_LoadTest_PageLoad_P95': data.metrics.page_load_time.p(95),
      'BART_LoadTest_SyncTime_P95': data.metrics.sync_time.p(95),
      'BART_LoadTest_Memory_P95': data.metrics.memory_usage.p(95),
    },
    thresholds: data.thresholds,
    testPassed: Object.values(data.thresholds).every((t: any) => t.ok),
  };

  // Send to CloudWatch via API
  const res = http.post(
    `${API_URL}/metrics/cloudwatch`,
    JSON.stringify(summary),
    {
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': __ENV.METRICS_API_KEY,
      },
    }
  );

  console.log('Test summary:', JSON.stringify(summary, null, 2));

  return {
    'stdout': JSON.stringify(summary, null, 2),
    'summary.json': JSON.stringify(summary),
  };
}
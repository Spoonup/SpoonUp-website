import { spawn } from 'child_process';

async function waitForServer(url, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {}
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error('Server did not start within timeout');
}

function runScript(scriptPath) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [scriptPath], { stdio: 'inherit' });
    child.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`${scriptPath} exited with code ${code}`));
    });
  });
}

async function main() {
  console.log('🚀 Starting Event Order System server for automated test run...');
  const server = spawn('node', ['server/index.js'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'test',
      ADMIN_PIN: process.env.ADMIN_PIN || '1234',
      SUPABASE_URL: '',
      SUPABASE_SERVICE_ROLE_KEY: '',
      SUPABASE_ANON_KEY: '',
      RAZORPAY_KEY_ID: '',
      RAZORPAY_KEY_SECRET: ''
    }
  });

  const cleanup = () => {
    try { server.kill('SIGTERM'); } catch {}
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  process.on('exit', cleanup);

  try {
    await waitForServer('http://127.0.0.1:5001/api/settings');
    console.log('✓ Server is live and responding on port 5001.\n');

    console.log('====================================================');
    console.log('TEST SUITE 1: End-to-End Customer & Admin Workflow');
    console.log('====================================================');
    await runScript('test-e2e.js');

    console.log('\n====================================================');
    console.log('TEST SUITE 2: Production Security & Zero-Trust IDOR');
    console.log('====================================================');
    await runScript('test-security.js');

    console.log('\n🌟 ALL SYSTEM & SECURITY TESTS COMPLETED SUCCESSFULLY! 🌟');
    cleanup();
    process.exit(0);
  } catch (err) {
    console.error('❌ Test suite failed:', err.message);
    cleanup();
    process.exit(1);
  }
}

main();

const http = require('http');

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      {
        hostname: 'localhost',
        port: 5000,
        path: path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
        }
      },
      (res) => {
        let respData = '';
        res.on('data', (chunk) => (respData += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(respData) });
          } catch (e) {
            resolve({ status: res.statusCode, body: respData });
          }
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function run() {
  const rand = Math.floor(1000 + Math.random() * 9000);
  console.log('Testing 1: Individual Affiliate without Email and without Business Details...');
  const res1 = await post('/public/partners/register', {
    firstName: 'Amit',
    lastName: 'Verma',
    phone: `982000${rand}`,
    whatsapp: `982000${rand}`,
    category: 'Individual (No Business)',
    state: 'Madhya Pradesh',
    pincode: '452001',
    notes: 'Excited to refer college friends'
  });
  console.log('Test 1 Status:', res1.status, JSON.stringify(res1.body, null, 2));

  console.log('\nTesting 2: Business Affiliate (Library) with all details...');
  const res2 = await post('/public/partners/register', {
    firstName: 'Suresh',
    lastName: 'Patel',
    phone: `983000${rand}`,
    whatsapp: `984000${rand}`,
    email: `suresh_${rand}@example.com`,
    category: 'Library',
    businessName: 'Patel Study Reading Room',
    address: 'Near Old Bus Stand, Ring Road',
    state: 'Gujarat',
    pincode: '380001',
    notes: 'Around 80 students visit daily'
  });
  console.log('Test 2 Status:', res2.status, JSON.stringify(res2.body, null, 2));

  console.log('\nTesting 3: Other Business with custom business field...');
  const res3 = await post('/public/partners/register', {
    firstName: 'Pooja',
    lastName: 'Sharma',
    phone: `985000${rand}`,
    whatsapp: `985000${rand}`,
    email: `pooja_${rand}@example.com`,
    category: 'Other Business',
    otherBusiness: 'Digital Printing & Cyber Hub',
    businessName: 'Sharma Digi Print',
    address: '14 Commerce Market, Main Street',
    state: 'Delhi',
    pincode: '110001',
    notes: 'Providing printing and student services'
  });
  console.log('Test 3 Status:', res3.status, JSON.stringify(res3.body, null, 2));
}

run().catch((err) => console.error('Test run failed:', err));

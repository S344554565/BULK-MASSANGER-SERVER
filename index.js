const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Uploads folder
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
const upload = multer({ dest: uploadsDir });

app.use(express.static(__dirname));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Live Dashboard (SSE) - Sirf logs dekhne ke liye jab browser khula ho
let clients = [];
app.get('/api/live-logs', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  clients.push(res);
  req.on('close', () => { clients = clients.filter(c => c !== res); });
});

function sendLog(message, type = 'info') {
  const data = JSON.stringify({ message, type, time: new Date().toLocaleTimeString() });
  clients.forEach(client => client.write(`data: ${data}\n\n`));
  console.log(`[${type.toUpperCase()}] ${message}`); // Server terminal mein bhi dikhega
}

// Delay function
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// MAIN ROUTE - Jahan se process start hoga
app.post('/api/start-bulk', upload.single('fileUpload'), async (req, res) => {
  try {
    // 1. Txt File, 2. Token, 3. Here Name, 4. Last Name, 5. Time, 6. Group UID
    const { token, hereName, lastName, timeDelay, groupUid } = req.body;
    const file = req.file;

    if (!token) return res.status(400).json({ error: 'Token zaroori hai!' });
    if (!file) return res.status(400).json({ error: 'TXT file upload karein!' });

    // File se UIDs nikalein
    const fileContent = fs.readFileSync(file.path, 'utf8');
    let uids = fileContent.split('\n').map(u => u.trim()).filter(u => u.length > 0);

    // Group UID bhi list mein add karein
    if (groupUid && groupUid.trim()) {
      uids.push(groupUid.trim());
    }
    
    uids = [...new Set(uids)]; // Duplicate hatao

    if (uids.length === 0) return res.status(400).json({ error: 'File mein koi UID nahi mila!' });

    // Response turant bhej dein taaki frontend hang na ho
    res.json({ success: true, message: 'Background process shuru ho gaya!' });

    const delayMs = Math.max(parseFloat(timeDelay) * 1000 || 3000, 1000);
    
    sendLog(`🚀 Background Process Started by ${hereName} ${lastName}`, 'success');
    sendLog(`🎯 Total Targets: ${uids.length} | Time Gap: ${delayMs/1000}s`, 'info');

    // BACKGROUND LOOP (Aap offline ho jayein toh bhi chalega)
    (async () => {
      for (let i = 0; i < uids.length; i++) {
        const uid = uids[i];
        sendLog(`[${i + 1}/${uids.length}] Sending to UID: ${uid}...`, 'info');

        try {
          // Actual API Call (Facebook Graph API)
          const response = await axios.post(
            'https://graph.facebook.com/v19.0/me/messages',
            {
              recipient: { id: uid },
              message: { text: `Hello from ${hereName} ${lastName}!` },
              messaging_type: 'RESPONSE'
            },
            {
              headers: { 'Authorization': `Bearer ${token.trim()}`, 'Content-Type': 'application/json' },
              timeout: 15000
            }
          );
          sendLog(`✅ Sent to ${uid} (ID: ${response.data.message_id})`, 'success');
        } catch (error) {
          const errCode = error.response?.data?.error?.code || 'Unknown';
          const errMsg = error.response?.data?.error?.message || error.message;
          sendLog(`❌ Error [${errCode}]: ${errMsg}`, 'error');
        }

        // Agle message ke liye wait karein
        if (i < uids.length - 1) {
          await wait(delayMs);
        }
      }
      
      sendLog(`🏁 Sabhi messages bhej diye gaye! Process Complete.`, 'success');
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path); // File delete
    })();

  } catch (err) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

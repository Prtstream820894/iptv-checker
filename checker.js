const axios = require('axios');
const fs = require('fs');

const PLAYLIST_URL = 'https://iptv-org.github.io/iptv/countries/in.m3u';

async function fetchPlaylist() {
    const response = await axios.get(PLAYLIST_URL);
    return response.data;
}

function parseM3U(data) {
    const lines = data.split('\n');
    const channels = [];
    let currentChannel = { rawHeader: '' };

    for (let line of lines) {
        line = line.trim();
        if (line.startsWith('#EXTINF:')) {
            let header = line;
            
            // अगर पहले से group-title है, तो उसे '🌎Worldwide - पुराना नाम' में बदल दें
            if (header.includes('group-title="')) {
                header = header.replace(/group-title="([^"]*)"/, (match, groupName) => {
                    return `group-title="🌎Worldwide - ${groupName}"`;
                });
            } else {
                // अगर group-title नहीं है, तो नया जोड़ दें
                header = header.replace('#EXTINF:-1', '#EXTINF:-1 group-title="🌎Worldwide"');
            }

            currentChannel.rawHeader = header;
            const nameMatch = line.match(/,(.+)$/);
            currentChannel.name = nameMatch ? nameMatch[1] : 'Unknown';
        } else if (line && !line.startsWith('#')) {
            currentChannel.url = line;
            channels.push({ ...currentChannel });
            currentChannel = { rawHeader: '' };
        }
    }
    return channels;
}

async function checkChannel(url) {
    try {
        const response = await axios.get(url, {
            timeout: 2000,
            headers: { 'User-Agent': 'Mozilla/5.0' },
            maxRedirects: 2
        });
        return response.status >= 200 && response.status < 400;
    } catch (error) {
        return false;
    }
}

async function main() {
    console.log('प्लेलिस्ट डाउनलोड हो रही है...');
    const rawData = await fetchPlaylist();
    const channels = parseM3U(rawData);
    
    console.log(`कुल ${channels.length} चैनल मिले। चेकिंग शुरू हो रही है...`);

    let workingChannels = [];
    const batchSize = 40; // स्पीड तेज रखने के लिए

    for (let i = 0; i < channels.length; i += batchSize) {
        const batch = channels.slice(i, i + batchSize);
        const promises = batch.map(async (ch) => {
            const isAlive = await checkChannel(ch.url);
            return isAlive ? ch : null;
        });

        const results = await Promise.all(promises);
        results.forEach(ch => {
            if (ch) {
                workingChannels.push(ch);
                console.log(`[🟢 LIVE]: ${ch.name}`);
            }
        });
    }

    let m3uContent = '#EXTM3U\n';
    workingChannels.forEach(ch => {
        m3uContent += `${ch.rawHeader}\n${ch.url}\n`;
    });

    fs.writeFileSync('working.m3u', m3uContent);
    console.log(`\nकाम पूरा हुआ! कुल ${workingChannels.length} चालू चैनल सेव हो गए हैं।`);
}

main();

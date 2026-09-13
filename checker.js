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
            let groupName = 'General';

            const groupMatch = header.match(/group-title="([^"]*)"/);
            if (groupMatch) {
                groupName = groupMatch[1];
            }

            const newGroupTitle = `🌎Worldwide - ${groupName}`;
            if (header.includes('group-title="')) {
                header = header.replace(/group-title="([^"]*)"/, `group-title="${newGroupTitle}"`);
            } else {
                header = header.replace('#EXTINF:-1', `#EXTINF:-1 group-title="${newGroupTitle}"`);
            }

            currentChannel.rawHeader = header;
            currentChannel.group = groupName.toLowerCase();
            
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
            timeout: 3000,
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' 
            },
            maxRedirects: 3,
            responseType: 'stream' // Stream format me check karenge taaki heavy data download na ho
        });

        // Check if status is success
        if (response.status < 200 || response.status >= 400) {
            return false;
        }

        const contentType = response.headers['content-type'] || '';
        
        // Agar response HTML hai (matलब error page ya website khul rahi hai, video stream nahi), toh use reject kar do
        if (contentType.includes('text/html') || contentType.includes('application/xhtml+xml')) {
            response.destroy();
            return false;
        }

        response.destroy();
        return true;
    } catch (error) {
        return false;
    }
}

async function main() {
    console.log('प्लेलिस्ट डाउनलोड हो रही है...');
    const rawData = await fetchPlaylist();
    const channels = parseM3U(rawData);
    
    console.log(`कुल ${channels.length} चैनल मिले। डीープ चेकिंग (Dead & Fake Links Filtering) शुरू ho rahi hai...`);

    let workingChannels = [];
    const batchSize = 20; // Chote batches rakhte hain taaki accurate response mile

    for (let i = 0; i < channels.length; i += batchSize) {
        const batch = channels.slice(i, i + batchSize);
        const promises = batch.map(async (ch) => {
            const isAlive = await checkChannel(ch.url);
            return isAlive ? ch : null;
        });

        const results = await Promise.all(promises);
        results.forEach(ch => {
            if (ch) workingChannels.push(ch);
        });
        console.log(`Progress: ${Math.min(i + batchSize, channels.length)}/${channels.length} checked...`);
    }

    const groupCounts = {};
    workingChannels.forEach(ch => {
        groupCounts[ch.group] = (groupCounts[ch.group] || 0) + 1;
    });

    workingChannels.forEach(ch => {
        if (groupCounts[ch.group] < 5) {
            ch.rawHeader = ch.rawHeader.replace(/group-title="[^"]*"/, 'group-title="🌎Worldwide - Others"');
            ch.group = 'others';
        }
    });

    const priorityOrder = ['entertainment', 'movies', 'kids', 'news', 'music'];

    workingChannels.sort((a, b) => {
        let indexA = priorityOrder.findIndex(p => a.group.includes(p));
        let indexB = priorityOrder.findIndex(p => b.group.includes(p));

        if (indexA === -1) indexA = 99;
        if (indexB === -1) indexB = 99;

        if (indexA !== indexB) {
            return indexA - indexB;
        }
        return a.group.localeCompare(b.group);
    });

    let m3uContent = '#EXTM3U\n';
    workingChannels.forEach(ch => {
        m3uContent += `${ch.rawHeader}\n${ch.url}\n`;
    });

    fs.writeFileSync('working.m3u', m3uContent);
    console.log(`\nकाम पूरा हुआ! FAKE aur DEAD links hata diye gaye hain. कुल ${workingChannels.length} 100% working channels save ho gaye hain.`);
}

main();

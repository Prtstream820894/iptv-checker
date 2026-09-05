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

            // ग्रुप का नाम ढूंढना
            const groupMatch = header.match(/group-title="([^"]*)"/);
            if (groupMatch) {
                groupName = groupMatch[1];
            }

            // ग्रुप के नाम के आगे 🌎Worldwide जोड़ना
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
    const batchSize = 40;

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
    }

    // 1. ग्रुप्स के हिसाब से चैनल गिनना ताकि पता चले किसमें 5 से कम हैं
    const groupCounts = {};
    workingChannels.forEach(ch => {
        groupCounts[ch.group] = (groupCounts[ch.group] || 0) + 1;
    });

    // 2. जिन ग्रुप्स में 5 से कम चैनल हैं, उनका ग्रुप बदलकर 'others' कर देना
    workingChannels.forEach(ch => {
        if (groupCounts[ch.group] < 5) {
            ch.rawHeader = ch.rawHeader.replace(/group-title="[^"]*"/, 'group-title="🌎Worldwide - Others"');
            ch.group = 'others';
        }
    });

    // 3. प्रायोरिटी सेट करना: Entertainment, Movies, Kids, News, Music ऊपर रहेंगे
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

    // M3U फाइल तैयार करना
    let m3uContent = '#EXTM3U\n';
    workingChannels.forEach(ch => {
        m3uContent += `${ch.rawHeader}\n${ch.url}\n`;
    });

    fs.writeFileSync('working.m3u', m3uContent);
    console.log(`\nकाम पूरा हुआ! कुल ${workingChannels.length} चालू चैनल सही क्रम में सेव हो गए हैं।`);
}

main();

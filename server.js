const express = require('express');
const axios = require('axios');
const cors = require('cors');
const NodeCache = require('node-cache');

const app = express();
const cache = new NodeCache({ stdTTL: 3600 });

app.use(cors({ origin: '*' }));
app.use(express.json());

// ⚠️ IMPORTANT: Get a free API key from https://rapidapi.com/ytjar/api/youtube-mp3-download1
// Sign up, subscribe to the free tier (100 requests/day)
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || 'YOUR_RAPIDAPI_KEY_HERE';

function extractVideoId(url) {
    if (url.includes('youtu.be/')) {
        return url.split('youtu.be/')[1].split('?')[0];
    } else if (url.includes('youtube.com/watch')) {
        const match = url.match(/[?&]v=([^&]+)/);
        return match ? match[1] : null;
    } else if (url.length === 11) {
        return url;
    }
    return null;
}

// Method 1: RapidAPI YouTube MP3 Downloader
async function tryRapidAPI(videoId) {
    if (!RAPIDAPI_KEY || RAPIDAPI_KEY === 'YOUR_RAPIDAPI_KEY_HERE') {
        console.log('RapidAPI key not configured');
        return null;
    }
    
    try {
        console.log('Trying RapidAPI...');
        
        const response = await axios.get('https://youtube-mp36.p.rapidapi.com/dl', {
            params: { id: videoId },
            headers: {
                'X-RapidAPI-Key': RAPIDAPI_KEY,
                'X-RapidAPI-Host': 'youtube-mp36.p.rapidapi.com'
            },
            timeout: 15000
        });
        
        const data = response.data;
        
        if (data.status === 'ok' && data.link) {
            return {
                success: true,
                videoId: videoId,
                title: data.title,
                author: data.author || 'Unknown',
                duration: data.duration || 0,
                thumbnail: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
                audioUrl: data.link,
                quality: '128kbps',
                views: 0,
                source: 'rapidapi'
            };
        }
        
        return null;
    } catch (error) {
        console.log('RapidAPI failed:', error.message);
        return null;
    }
}

// Method 2: YouTube Explode API (another RapidAPI service)
async function tryYouTubeExplode(videoId) {
    if (!RAPIDAPI_KEY || RAPIDAPI_KEY === 'YOUR_RAPIDAPI_KEY_HERE') {
        return null;
    }
    
    try {
        console.log('Trying YouTube Explode API...');
        
        const response = await axios.get(`https://youtube-video-download-info.p.rapidapi.com/dl`, {
            params: { id: videoId },
            headers: {
                'X-RapidAPI-Key': RAPIDAPI_KEY,
                'X-RapidAPI-Host': 'youtube-video-download-info.p.rapidapi.com'
            },
            timeout: 15000
        });
        
        const data = response.data;
        
        if (data.status === 'ok' && data.link) {
            return {
                success: true,
                videoId: videoId,
                title: data.title,
                author: data.author || 'Unknown',
                duration: data.duration || 0,
                thumbnail: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
                audioUrl: data.link,
                quality: data.quality || '128kbps',
                views: 0,
                source: 'youtube_explode'
            };
        }
        
        return null;
    } catch (error) {
        console.log('YouTube Explode API failed:', error.message);
        return null;
    }
}

// Method 3: Local yt-dlp (if installed)
async function tryYtDlp(videoId) {
    try {
        console.log('Trying yt-dlp...');
        
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execPromise = promisify(exec);
        
        // Check if yt-dlp is installed
        try {
            await execPromise('yt-dlp --version', { timeout: 3000 });
        } catch {
            console.log('yt-dlp not installed');
            return null;
        }
        
        const url = `https://www.youtube.com/watch?v=${videoId}`;
        
        // Get JSON data with audio URL
        const { stdout } = await execPromise(
            `yt-dlp -f bestaudio --dump-json --no-playlist "${url}"`,
            { timeout: 20000, maxBuffer: 1024 * 1024 * 10 }
        );
        
        const data = JSON.parse(stdout.trim());
        
        return {
            success: true,
            videoId: videoId,
            title: data.title,
            author: data.uploader || data.channel,
            duration: data.duration,
            thumbnail: data.thumbnail,
            audioUrl: data.url,
            quality: `${Math.round(data.abr || 0)}kbps`,
            views: data.view_count || 0,
            source: 'yt-dlp'
        };
    } catch (error) {
        console.log('yt-dlp failed:', error.message);
        return null;
    }
}

// Method 4: oEmbed (info only)
async function tryOEmbed(videoId) {
    try {
        console.log('Trying oEmbed (info only)...');
        const response = await axios.get(
            `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
            { timeout: 5000 }
        );
        
        return {
            success: true,
            videoId: videoId,
            title: response.data.title,
            author: response.data.author_name,
            duration: 0,
            thumbnail: response.data.thumbnail_url,
            audioUrl: null,
            quality: 'N/A',
            views: 0,
            source: 'oembed',
            warning: 'Audio URL not available - info only. Please configure RapidAPI key or install yt-dlp.'
        };
    } catch (error) {
        console.log('oEmbed failed:', error.message);
        return null;
    }
}

// Main endpoint
app.get('/api/audio', async (req, res) => {
    try {
        const url = req.query.url || req.query.v;
        
        if (!url) {
            return res.status(400).json({ 
                success: false, 
                error: 'No URL provided. Use ?url=YOUTUBE_URL or ?v=VIDEO_ID' 
            });
        }
        
        const videoId = extractVideoId(url);
        
        if (!videoId) {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid YouTube URL or video ID' 
            });
        }
        
        console.log('\n🔄 Processing:', videoId);
        
        // Check cache
        const cached = cache.get(videoId);
        if (cached && cached.audioUrl) {
            console.log('✅ Cache hit!');
            return res.json(cached);
        }
        
        // Try methods in order
        let result = null;
        
        // Try yt-dlp first (most reliable if installed)
        result = await tryYtDlp(videoId);
        if (result && result.audioUrl) {
            cache.set(videoId, result);
            console.log('✅ Success via yt-dlp:', result.title);
            return res.json(result);
        }
        
        // Try RapidAPI
        result = await tryRapidAPI(videoId);
        if (result && result.audioUrl) {
            cache.set(videoId, result);
            console.log('✅ Success via RapidAPI:', result.title);
            return res.json(result);
        }
        
        // Try YouTube Explode
        result = await tryYouTubeExplode(videoId);
        if (result && result.audioUrl) {
            cache.set(videoId, result);
            console.log('✅ Success via YouTube Explode:', result.title);
            return res.json(result);
        }
        
        // Fallback to info only
        result = await tryOEmbed(videoId);
        if (result) {
            console.log('⚠️  Info only via oEmbed');
            return res.json(result);
        }
        
        throw new Error('All methods failed');
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to process video',
            details: error.message,
            setup_instructions: {
                option1: 'Install yt-dlp: https://github.com/yt-dlp/yt-dlp/releases',
                option2: 'Get RapidAPI key: https://rapidapi.com/ytjar/api/youtube-mp3-download1',
                option3: 'Set environment variable: RAPIDAPI_KEY=your_key_here'
            }
        });
    }
});

// Setup guide endpoint
app.get('/setup', (req, res) => {
    res.json({
        title: '🔧 Setup Instructions',
        current_status: {
            rapidapi_configured: RAPIDAPI_KEY !== 'YOUR_RAPIDAPI_KEY_HERE',
            yt_dlp_detected: 'Run /api/test/VIDEO_ID to check'
        },
        instructions: {
            method1_yt_dlp: {
                name: 'yt-dlp (Recommended - Free & Reliable)',
                steps: [
                    '1. Download from: https://github.com/yt-dlp/yt-dlp/releases/latest',
                    '2. Windows: Download yt-dlp.exe and place in C:\\Windows\\System32\\',
                    '3. Or use: winget install yt-dlp',
                    '4. Verify: yt-dlp --version',
                    '5. Restart this server'
                ],
                pros: 'Free, unlimited, most reliable'
            },
            method2_rapidapi: {
                name: 'RapidAPI (Easiest)',
                steps: [
                    '1. Go to: https://rapidapi.com/hub',
                    '2. Sign up for free account',
                    '3. Subscribe to: https://rapidapi.com/ytjar/api/youtube-mp3-download1',
                    '4. Copy your API key',
                    '5. Set environment variable: RAPIDAPI_KEY=your_key',
                    '6. Or edit server.js line 11',
                    '7. Restart server'
                ],
                pros: 'Easy setup, 100 requests/day free tier',
                free_tier: '100 requests per day'
            }
        },
        test_endpoint: '/api/test/dQw4w9WgXcQ'
    });
});

// Test endpoint
app.get('/api/test/:videoId', async (req, res) => {
    const videoId = req.params.videoId;
    
    console.log('\n🧪 Testing all methods for:', videoId);
    
    const results = {
        videoId: videoId,
        timestamp: new Date().toISOString(),
        config: {
            rapidapi_key_set: RAPIDAPI_KEY !== 'YOUR_RAPIDAPI_KEY_HERE'
        },
        tests: {}
    };
    
    // Test yt-dlp
    const ytdlpResult = await tryYtDlp(videoId);
    results.tests.yt_dlp = {
        status: ytdlpResult ? 'SUCCESS ✅' : 'FAILED ❌',
        hasAudio: !!ytdlpResult?.audioUrl,
        note: ytdlpResult ? 'Working!' : 'Not installed. Install from: https://github.com/yt-dlp/yt-dlp/releases'
    };
    
    // Test RapidAPI
    const rapidResult = await tryRapidAPI(videoId);
    results.tests.rapidapi = {
        status: rapidResult ? 'SUCCESS ✅' : 'FAILED ❌',
        hasAudio: !!rapidResult?.audioUrl,
        note: rapidResult ? 'Working!' : RAPIDAPI_KEY === 'YOUR_RAPIDAPI_KEY_HERE' ? 
            'Not configured. Get key from: https://rapidapi.com/ytjar/api/youtube-mp3-download1' : 
            'Check your API key'
    };
    
    // Test YouTube Explode
    const explodeResult = await tryYouTubeExplode(videoId);
    results.tests.youtube_explode = {
        status: explodeResult ? 'SUCCESS ✅' : 'FAILED ❌',
        hasAudio: !!explodeResult?.audioUrl
    };
    
    // Test oEmbed
    const oembedResult = await tryOEmbed(videoId);
    results.tests.oembed = {
        status: oembedResult ? 'SUCCESS ✅' : 'FAILED ❌',
        hasAudio: false,
        note: 'Info only, no audio URL'
    };
    
    results.recommendation = ytdlpResult || rapidResult ? 
        '✅ API is working!' : 
        '⚠️ No working method found. Please install yt-dlp or configure RapidAPI.';
    
    res.json(results);
});

// Info endpoint
app.get('/api/info/:videoId', async (req, res) => {
    try {
        const result = await tryOEmbed(req.params.videoId);
        res.json(result || { success: false, error: 'Failed to fetch info' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Health check
app.get('/', (req, res) => {
    res.json({ 
        status: '✅ API is running',
        version: '6.0 - Production Ready',
        methods: ['yt-dlp', 'RapidAPI', 'YouTube Explode', 'oEmbed'],
        setup_status: {
            rapidapi_configured: RAPIDAPI_KEY !== 'YOUR_RAPIDAPI_KEY_HERE',
            setup_guide: '/setup'
        },
        endpoints: {
            audio: '/api/audio?url=YOUTUBE_URL or ?v=VIDEO_ID',
            info: '/api/info/VIDEO_ID',
            test: '/api/test/VIDEO_ID',
            setup: '/setup',
            health: '/health'
        },
        cached: cache.keys().length,
        uptime: Math.floor(process.uptime())
    });
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy',
        uptime: process.uptime(),
        cached: cache.keys().length
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('╔═══════════════════════════════════════╗');
    console.log('║   🎵 YouTube Audio API Server        ║');
    console.log(`║   📡 Port: ${PORT}                      ║`);
    console.log('║   🚀 Production Ready                ║');
    console.log('╚═══════════════════════════════════════╝');
    console.log('');
    
    if (RAPIDAPI_KEY === 'YOUR_RAPIDAPI_KEY_HERE') {
        console.log('⚠️  RapidAPI key not configured');
    } else {
        console.log('✅ RapidAPI key configured');
    }
    
    console.log('');
    console.log('📚 Setup Guide:');
    console.log(`   http://localhost:${PORT}/setup`);
    console.log('');
    console.log('🧪 Test all methods:');
    console.log(`   http://localhost:${PORT}/api/test/dQw4w9WgXcQ`);
    console.log('');
    console.log('🎵 Get audio:');
    console.log(`   http://localhost:${PORT}/api/audio?v=dQw4w9WgXcQ`);
    console.log('');
});
const express = require('express');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');
const crypto = require('crypto');

// Determine FFmpeg binary path (system PATH or bundled ffmpeg-static)
let ffmpegPath = 'ffmpeg';
try {
  execSync('ffmpeg -version', { stdio: 'ignore' });
} catch {
  try {
    ffmpegPath = require('ffmpeg-static');
  } catch {
    console.warn('Cảnh báo: Không tìm thấy ffmpeg trong PATH hoặc ffmpeg-static.');
  }
}

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const VIDEOS_DIR = path.join(DATA_DIR, 'videos');
const STREAMS_FILE = path.join(DATA_DIR, 'streams.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(VIDEOS_DIR)) {
  fs.mkdirSync(VIDEOS_DIR, { recursive: true });
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/**
 * Check if request originates from the host computer itself (localhost)
 * or has explicitly unlocked remote host control.
 */
function isHostControlAllowed(req) {
  const hostHeader = (req.headers.host || '').toLowerCase();
  const isLocalhost =
    hostHeader.startsWith('localhost:') ||
    hostHeader.startsWith('127.0.0.1:') ||
    hostHeader === 'localhost' ||
    hostHeader === '127.0.0.1';
  const unlockedHeader = req.headers['x-host-unlock'] === 'allow-host-control';
  return isLocalhost || unlockedHeader;
}

// ============================================================================
// 0. PUBLIC ONLINE TUNNEL & CLIENT-SIDE DISTRIBUTABLE APP LAUNCHER
// ============================================================================

let tunnelState = {
  status: 'starting',
  publicUrl: null,
  error: null,
  startedAt: null,
  proc: null
};

function getLanUrls() {
  const nets = os.networkInterfaces();
  const urls = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        urls.push(`http://${net.address}:${PORT}`);
      }
    }
  }
  return urls;
}

function getCloudflaredBinary() {
  const localWin = path.join(__dirname, 'cloudflared.exe');
  if (fs.existsSync(localWin)) return localWin;
  const localUnix = path.join(__dirname, 'cloudflared');
  if (fs.existsSync(localUnix)) return localUnix;
  try {
    execSync('cloudflared --version', { stdio: 'ignore' });
    return 'cloudflared';
  } catch {
    return null;
  }
}

function startPublicTunnel() {
  if (tunnelState.proc) {
    try {
      tunnelState.proc.kill('SIGTERM');
    } catch {}
    tunnelState.proc = null;
  }

  const bin = getCloudflaredBinary();
  if (!bin) {
    tunnelState.status = 'error';
    tunnelState.error = 'Chưa cài đặt cloudflared trên máy này.';
    return;
  }

  tunnelState.status = 'starting';
  tunnelState.publicUrl = null;
  tunnelState.error = null;
  tunnelState.startedAt = new Date().toISOString();

  const proc = spawn(
    bin,
    ['tunnel', '--url', `http://127.0.0.1:${PORT}`, '--no-autoupdate'],
    { windowsHide: true }
  );
  tunnelState.proc = proc;

  const parseOutput = (chunk) => {
    const text = chunk.toString('utf8');
    const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
    if (match && !tunnelState.publicUrl) {
      tunnelState.publicUrl = match[0];
      tunnelState.status = 'online';
      console.log(`🌍 Link Web Share (Tải & Chạy độc lập trên máy người nhận): ${tunnelState.publicUrl}`);
    }
  };

  proc.stdout.on('data', parseOutput);
  proc.stderr.on('data', parseOutput);

  proc.on('error', (err) => {
    tunnelState.status = 'error';
    tunnelState.error = err.message;
    tunnelState.proc = null;
  });

  proc.on('close', () => {
    tunnelState.proc = null;
    if (tunnelState.status !== 'stopped') {
      tunnelState.status = 'stopped';
    }
  });
}

/**
 * Serves the application source bundle so any shared machine can download & run
 * the app locally on ITS OWN CPU/RAM in seconds!
 */
app.get('/api/app-bundle.json', (req, res) => {
  try {
    const filesToBundle = [
      'package.json',
      'server.js',
      'start-windows.bat',
      'Open-Desktop-App.vbs',
      'setup-vps-ubuntu.sh',
      'public/index.html',
      'public/manifest.json'
    ];
    const bundle = {};
    for (const relPath of filesToBundle) {
      const fullPath = path.join(__dirname, relPath);
      if (fs.existsSync(fullPath)) {
        bundle[relPath] = fs.readFileSync(fullPath, 'utf8');
      }
    }
    res.json({ ok: true, files: bundle });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * Generates a PowerShell Auto-Installer & Local Launcher script that sets up
 * and runs the app on the RECIPIENT'S OWN COMPUTER (eating 100% recipient's CPU/RAM).
 */
function buildRecipientPowerShellInstaller(originUrl) {
  return `
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "  KHOI TAO YOUTUBE MULTI-STREAM MANAGER TREN MAY TINH CUA BAN" -ForegroundColor Green
Write-Host "  (Su dung 100% CPU / RAM tren may cua ban - Hoan toan doc lap)" -ForegroundColor Yellow
Write-Host "================================================================" -ForegroundColor Cyan

$InstallDir = Join-Path $env:USERPROFILE "YouTube-Live-Manager"
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $InstallDir "public") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $InstallDir "data") | Out-Null

Write-Host "[1/4] Dang tai ma nguon ung dung..." -ForegroundColor Cyan
$BundleUrl = "${originUrl}/api/app-bundle.json"
$Bundle = Invoke-RestMethod -Uri $BundleUrl -Method Get

foreach ($prop in $Bundle.files.PSObject.Properties) {
    $targetPath = Join-Path $InstallDir ($prop.Name -replace '/', '\\')
    $parentDir = Split-Path -Parent $targetPath
    if (-not (Test-Path $parentDir)) {
        New-Item -ItemType Directory -Force -Path $parentDir | Out-Null
    }
    [System.IO.File]::WriteAllText($targetPath, $prop.Value, [System.Text.Encoding]::UTF8)
}

# Check if Node.js is installed on recipient's machine; if not, download portable Node.js
$NodeExe = "node"
$NpmCmd = "npm.cmd"
try {
    $null = & node --version 2>$null
} catch {
    $PortableNodeDir = Join-Path $InstallDir "runtime\\node-v20.18.0-win-x64"
    $PortableNodeExe = Join-Path $PortableNodeDir "node.exe"
    if (-not (Test-Path $PortableNodeExe)) {
        Write-Host "[2/4] May ban chua co Node.js -> Dang tai Node.js Portable..." -ForegroundColor Yellow
        New-Item -ItemType Directory -Force -Path (Join-Path $InstallDir "runtime") | Out-Null
        $NodeZip = Join-Path $InstallDir "runtime\\node.zip"
        curl.exe -L "https://nodejs.org/dist/v20.18.0/node-v20.18.0-win-x64.zip" -o $NodeZip
        Expand-Archive -Path $NodeZip -DestinationPath (Join-Path $InstallDir "runtime") -Force
        Remove-Item $NodeZip -Force -ErrorAction SilentlyContinue
    }
    $env:PATH = "$PortableNodeDir;" + $env:PATH
    $NodeExe = $PortableNodeExe
    $NpmCmd = Join-Path $PortableNodeDir "npm.cmd"
}

Set-Location $InstallDir
if (-not (Test-Path (Join-Path $InstallDir "node_modules"))) {
    Write-Host "[3/4] Dang cai dat bo xu ly FFmpeg tren may cua ban..." -ForegroundColor Cyan
    & $NpmCmd install --omit=dev
    & $NodeExe "node_modules/ffmpeg-static/install.js"
}

# Create Desktop Shortcut on recipient's Desktop
try {
    $WshShell = New-Object -ComObject WScript.Shell
    $ShortcutPath = Join-Path ([Environment]::GetFolderPath("Desktop")) "YouTube Live Manager.lnk"
    $Shortcut = $WshShell.CreateShortcut($ShortcutPath)
    $Shortcut.TargetPath = "wscript.exe"
    $Shortcut.Arguments = """" + (Join-Path $InstallDir "Open-Desktop-App.vbs") + """"
    $Shortcut.WorkingDirectory = $InstallDir
    $Shortcut.Description = "YouTube Multi-Stream Manager (Chay doc lap tren may cua ban)"
    $Shortcut.Save()
    Write-Host "✅ Da tao bieu tuong 'YouTube Live Manager' tren man hinh Desktop cua ban!" -ForegroundColor Green
} catch {}

Write-Host "[4/4] Dang mo App tren may tinh cua ban (http://localhost:3000)..." -ForegroundColor Green
Start-Process -FilePath $NodeExe -ArgumentList "server.js", "--desktop" -WorkingDirectory $InstallDir
`;
}

app.get('/download/install.ps1', (req, res) => {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const originUrl = `${proto}://${req.headers.host}`;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(buildRecipientPowerShellInstaller(originUrl));
});

/**
 * 1-Click `.bat` launcher downloaded from the Web Link by the recipient.
 * When double-clicked on the recipient's PC, it installs & runs the app on THEIR CPU/RAM!
 */
app.get('/download/Mo-App-YouTube-Live-Tren-May-Nay.bat', (req, res) => {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const originUrl = `${proto}://${req.headers.host}`;
  const batContent = [
    '@echo off',
    'chcp 65001 >nul',
    'title Cai dat & Chay YouTube Live Manager tren may tinh cua ban',
    'echo ====================================================================',
    'echo   DANG KHOI TAO YOUTUBE LIVE MANAGER TREN CPU/RAM MAY TINH CUA BAN',
    'echo ====================================================================',
    `powershell -NoProfile -ExecutionPolicy Bypass -Command "irm '${originUrl}/download/install.ps1' | iex"`,
    'pause'
  ].join('\r\n');

  res.setHeader('Content-Disposition', 'attachment; filename="Mo-App-YouTube-Live-Tren-May-Nay.bat"');
  res.setHeader('Content-Type', 'application/octet-stream');
  res.send(batContent);
});

/**
 * Serve pre-packaged Portable ZIP if available
 */
app.get('/download/YouTube-Live-Manager-Portable.zip', (req, res) => {
  const zipPath = path.join(__dirname, 'YouTube-Live-Manager-Portable.zip');
  if (fs.existsSync(zipPath)) {
    res.download(zipPath, 'YouTube-Live-Manager-Portable.zip');
  } else {
    res.redirect('/download/Mo-App-YouTube-Live-Tren-May-Nay.bat');
  }
});

// ============================================================================
// 1. GOOGLE DRIVE LINK PARSER & VIDEO DOWNLOADER WITH REALTIME PROGRESS
// ============================================================================

function extractDriveFileId(input) {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();

  if (/^[a-zA-Z0-9_-]{25,50}$/.test(trimmed)) {
    return trimmed;
  }

  const fileMatch = trimmed.match(/\/(?:file\/)?d\/([a-zA-Z0-9_-]{20,50})/);
  if (fileMatch) return fileMatch[1];

  const idParamMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]{20,50})/);
  if (idParamMatch) return idParamMatch[1];

  return null;
}

const driveUrlCache = new Map();
const CACHE_TTL_MS = 15 * 60 * 1000;

async function resolveDriveStreamInfo(fileId, forceRefresh = false) {
  const cached = driveUrlCache.get(fileId);
  if (!forceRefresh && cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached;
  }

  const initialUrl = `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`;
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': '*/*'
  };

  const response = await fetch(initialUrl, {
    method: 'GET',
    headers,
    redirect: 'follow'
  });

  const setCookieHeader = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
  const cookies = setCookieHeader.map(c => c.split(';')[0]).join('; ');
  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('text/html')) {
    const html = await response.text();

    if (html.includes('Sign in') && html.includes('accounts.google.com') && !html.includes('download-form')) {
      throw new Error('File Google Drive đang để chế độ Riêng tư (Private). Vui lòng bật chia sẻ "Bất kỳ ai có đường liên kết".');
    }

    const actionMatch = html.match(/action="([^"]+)"/);
    const actionUrl = actionMatch
      ? actionMatch[1].replace(/&amp;/g, '&')
      : 'https://drive.usercontent.google.com/download';

    const params = new URLSearchParams();
    const inputRegex = /<input[^>]+type="hidden"[^>]+name="([^"]+)"[^>]+value="([^"]*)"/g;
    let match;
    while ((match = inputRegex.exec(html)) !== null) {
      params.set(match[1], match[2]);
    }

    if (!params.has('id')) params.set('id', fileId);
    if (!params.has('export')) params.set('export', 'download');
    if (!params.has('confirm')) params.set('confirm', 't');

    const directUrl = `${actionUrl}?${params.toString()}`;
    const info = {
      fileId,
      directUrl,
      cookies,
      timestamp: Date.now()
    };
    driveUrlCache.set(fileId, info);
    return info;
  }

  try {
    if (response.body) await response.body.cancel();
  } catch {}

  const info = {
    fileId,
    directUrl: response.url || `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=t`,
    cookies,
    timestamp: Date.now()
  };
  driveUrlCache.set(fileId, info);
  return info;
}

const downloadJobs = new Map();

function getLocalVideoPath(fileId) {
  return path.join(VIDEOS_DIR, `${fileId}.mp4`);
}

function getDownloadJobStatus(fileId) {
  if (!fileId) return null;
  const finalPath = getLocalVideoPath(fileId);
  const existingJob = downloadJobs.get(fileId);

  if (existingJob) {
    return {
      fileId: existingJob.fileId,
      status: existingJob.status,
      progress: existingJob.progress,
      downloadedBytes: existingJob.downloadedBytes,
      totalBytes: existingJob.totalBytes,
      downloadedMB: (existingJob.downloadedBytes / (1024 * 1024)).toFixed(2),
      totalMB: existingJob.totalBytes ? (existingJob.totalBytes / (1024 * 1024)).toFixed(2) : null,
      fileName: existingJob.fileName || `drive_${fileId.slice(0, 8)}.mp4`,
      filePath: existingJob.filePath,
      error: existingJob.error || null
    };
  }

  if (fs.existsSync(finalPath)) {
    const stat = fs.statSync(finalPath);
    if (stat.size > 10240) {
      const completedJob = {
        fileId,
        status: 'completed',
        progress: 100,
        downloadedBytes: stat.size,
        totalBytes: stat.size,
        fileName: `drive_${fileId.slice(0, 8)}.mp4`,
        filePath: finalPath,
        error: null,
        callbacks: []
      };
      downloadJobs.set(fileId, completedJob);
      return getDownloadJobStatus(fileId);
    }
  }

  return null;
}

function ensureDriveVideoDownloaded(fileId, onCompleteCallback = null) {
  const finalPath = getLocalVideoPath(fileId);
  let job = downloadJobs.get(fileId);

  if (fs.existsSync(finalPath)) {
    const stat = fs.statSync(finalPath);
    if (stat.size > 10240 && (!job || job.status !== 'downloading')) {
      job = {
        fileId,
        status: 'completed',
        progress: 100,
        downloadedBytes: stat.size,
        totalBytes: stat.size,
        fileName: job?.fileName || `drive_${fileId.slice(0, 8)}.mp4`,
        filePath: finalPath,
        error: null,
        callbacks: []
      };
      downloadJobs.set(fileId, job);
      if (onCompleteCallback) onCompleteCallback(null, job);
      return job;
    }
  }

  if (job && job.status === 'downloading') {
    if (onCompleteCallback) job.callbacks.push(onCompleteCallback);
    return job;
  }

  job = {
    fileId,
    status: 'downloading',
    progress: 0,
    downloadedBytes: 0,
    totalBytes: 0,
    fileName: `drive_${fileId.slice(0, 8)}.mp4`,
    filePath: finalPath,
    error: null,
    callbacks: onCompleteCallback ? [onCompleteCallback] : []
  };
  downloadJobs.set(fileId, job);

  const tempPath = `${finalPath}.part`;

  resolveDriveStreamInfo(fileId, true)
    .then((info) => {
      const reqHeaders = {};
      if (info.cookies) reqHeaders['Cookie'] = info.cookies;
      downloadFromUrlWithRedirects(info.directUrl, reqHeaders, tempPath, finalPath, job, 6);
    })
    .catch((err) => {
      job.status = 'error';
      job.error = err.message || 'Không thể kết nối tới Google Drive.';
      const cbs = job.callbacks.splice(0);
      for (const cb of cbs) cb(new Error(job.error), job);
    });

  return job;
}

function downloadFromUrlWithRedirects(targetUrl, reqHeaders, tempPath, finalPath, job, redirectsLeft) {
  if (redirectsLeft <= 0) {
    job.status = 'error';
    job.error = 'Quá nhiều lần chuyển hướng từ Google Drive.';
    const cbs = job.callbacks.splice(0);
    for (const cb of cbs) cb(new Error(job.error), job);
    return;
  }

  const parsedUrl = new URL(targetUrl);
  const client = parsedUrl.protocol === 'https:' ? https : http;

  const options = {
    protocol: parsedUrl.protocol,
    hostname: parsedUrl.hostname,
    port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
    path: parsedUrl.pathname + parsedUrl.search,
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      ...reqHeaders
    }
  };

  const req = client.request(options, (res) => {
    if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
      res.resume();
      const nextUrl = new URL(res.headers.location, targetUrl).toString();
      return downloadFromUrlWithRedirects(nextUrl, reqHeaders, tempPath, finalPath, job, redirectsLeft - 1);
    }

    const contentType = res.headers['content-type'] || '';
    if (contentType.includes('text/html')) {
      res.resume();
      job.status = 'error';
      job.error = 'File Google Drive chưa bật quyền "Bất kỳ ai có đường liên kết đều có thể xem" hoặc không phải file video.';
      const cbs = job.callbacks.splice(0);
      for (const cb of cbs) cb(new Error(job.error), job);
      return;
    }

    const disposition = res.headers['content-disposition'] || '';
    const nameMatch = disposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)["']?/i);
    if (nameMatch) {
      try {
        job.fileName = decodeURIComponent(nameMatch[1]);
      } catch {
        job.fileName = nameMatch[1];
      }
    }

    const totalLength = parseInt(res.headers['content-length'] || '0', 10);
    if (totalLength > 0) {
      job.totalBytes = totalLength;
    }

    const fileStream = fs.createWriteStream(tempPath);
    job.downloadedBytes = 0;

    res.on('data', (chunk) => {
      job.downloadedBytes += chunk.length;
      if (job.totalBytes > 0) {
        job.progress = Math.min(99, Math.round((job.downloadedBytes / job.totalBytes) * 100));
      } else {
        job.progress = Math.min(95, Math.floor(job.downloadedBytes / (1024 * 512)));
      }
    });

    res.pipe(fileStream);

    fileStream.on('finish', () => {
      fileStream.close(() => {
        try {
          if (fs.existsSync(finalPath)) {
            fs.unlinkSync(finalPath);
          }
          fs.renameSync(tempPath, finalPath);
          job.status = 'completed';
          job.progress = 100;
          if (!job.totalBytes) job.totalBytes = job.downloadedBytes;
          job.filePath = finalPath;

          const cbs = job.callbacks.splice(0);
          for (const cb of cbs) cb(null, job);
        } catch (err) {
          job.status = 'error';
          job.error = `Lỗi lưu file video: ${err.message}`;
          const cbs = job.callbacks.splice(0);
          for (const cb of cbs) cb(err, job);
        }
      });
    });

    fileStream.on('error', (err) => {
      res.destroy();
      job.status = 'error';
      job.error = `Lỗi ghi ổ cứng: ${err.message}`;
      const cbs = job.callbacks.splice(0);
      for (const cb of cbs) cb(err, job);
    });
  });

  req.on('error', (err) => {
    job.status = 'error';
    job.error = `Lỗi mạng khi tải từ Google Drive: ${err.message}`;
    const cbs = job.callbacks.splice(0);
    for (const cb of cbs) cb(err, job);
  });

  req.end();
}

app.post('/api/drive-download', (req, res) => {
  if (!isHostControlAllowed(req)) {
    return res.status(403).json({
      ok: false,
      error: 'Bạn đang mở Link Share từ xa. Vui lòng nhấn "Tải & Mở App trên máy này" để dùng CPU/RAM máy của bạn!'
    });
  }
  const { link } = req.body;
  if (!link || !link.trim()) {
    return res.status(400).json({ ok: false, error: 'Vui lòng nhập link Google Drive.' });
  }

  const fileId = extractDriveFileId(link);
  if (!fileId) {
    return res.status(400).json({
      ok: false,
      error: 'Link Google Drive không đúng định dạng. Hãy dán link dạng https://drive.google.com/file/d/.../view'
    });
  }

  ensureDriveVideoDownloaded(fileId);
  return res.json({
    ok: true,
    ...getDownloadJobStatus(fileId)
  });
});

app.get('/api/drive-download/:fileId', (req, res) => {
  const { fileId } = req.params;
  const status = getDownloadJobStatus(fileId);
  if (!status) {
    return res.status(404).json({ ok: false, error: 'Chưa có tiến trình tải cho File ID này.' });
  }
  return res.json({ ok: true, ...status });
});

app.get('/api/drive-check', (req, res) => {
  const { link } = req.query;
  if (!link) {
    return res.status(400).json({ ok: false, error: 'Vui lòng nhập link Google Drive.' });
  }
  const fileId = extractDriveFileId(link);
  if (!fileId) {
    return res.status(400).json({
      ok: false,
      error: 'Không nhận diện được mã File ID từ link Google Drive này.'
    });
  }
  ensureDriveVideoDownloaded(fileId);
  return res.json({
    ok: true,
    ...getDownloadJobStatus(fileId)
  });
});

// ============================================================================
// 2. MULTI-STREAM MANAGER & PERSISTENCE
// ============================================================================

let streams = [];
const activeProcesses = new Map();

function loadStreams() {
  try {
    if (fs.existsSync(STREAMS_FILE)) {
      const raw = fs.readFileSync(STREAMS_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        streams = parsed.map(s => ({
          ...s,
          encodeMode: s.encodeMode === 'copy_explicit' ? 'copy_explicit' : 'transcode',
          wasRunningBeforeRestart: s.status === 'live' || s.status === 'starting' || s.status === 'downloading',
          status: s.status === 'scheduled' && s.scheduledAt && new Date(s.scheduledAt).getTime() > Date.now()
            ? 'scheduled'
            : 'stopped',
          error: null
        }));
      }
    }
  } catch (err) {
    console.error('Lỗi đọc file streams.json:', err.message);
    streams = [];
  }
}

function saveStreams() {
  try {
    const serializable = streams.map(s => ({
      id: s.id,
      name: s.name,
      streamKey: s.streamKey,
      rtmpUrl: s.rtmpUrl || 'rtmp://a.rtmp.youtube.com/live2',
      driveLink: s.driveLink,
      fileId: s.fileId,
      loop: Boolean(s.loop),
      duration: Number(s.duration) || 0,
      durationUnit: s.durationUnit || 'minutes',
      durationSeconds: Number(s.durationSeconds) || 0,
      scheduledAt: s.scheduledAt || null,
      encodeMode: s.encodeMode || 'transcode',
      status: s.status,
      createdAt: s.createdAt,
      lastStartedAt: s.lastStartedAt || null
    }));
    fs.writeFileSync(STREAMS_FILE, JSON.stringify(serializable, null, 2), 'utf8');
  } catch (err) {
    console.error('Lỗi lưu file streams.json:', err.message);
  }
}

loadStreams();

function computeDurationSeconds(duration, unit = 'minutes') {
  const val = Number(duration);
  if (!val || val <= 0) return 0;
  if (unit === 'seconds') return Math.floor(val);
  if (unit === 'hours') return Math.floor(val * 3600);
  return Math.floor(val * 60);
}

function getOrCreateRuntime(streamId) {
  let runtime = activeProcesses.get(streamId);
  if (!runtime) {
    runtime = {
      proc: null,
      logs: [],
      startedAt: null,
      fps: '0',
      bitrate: '0 kbits/s',
      speed: '0x',
      frame: '0',
      loopCount: 0,
      stopRequested: false,
      restartTimer: null,
      durationTimer: null
    };
    activeProcesses.set(streamId, runtime);
  }
  return runtime;
}

function appendStreamLog(streamId, text) {
  const runtime = getOrCreateRuntime(streamId);
  const timestamp = new Date().toLocaleTimeString('vi-VN', { hour12: false });
  const lines = text.split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    runtime.logs.push(`[${timestamp}] ${line}`);
    if (runtime.logs.length > 200) {
      runtime.logs.shift();
    }

    if (line.includes('fps=') || line.includes('bitrate=')) {
      const fpsMatch = line.match(/fps=\s*([\d.]+)/);
      const bitMatch = line.match(/bitrate=\s*([^\s]+)/);
      const speedMatch = line.match(/speed=\s*([^\s]+)/);
      const frameMatch = line.match(/frame=\s*(\d+)/);

      if (fpsMatch) runtime.fps = fpsMatch[1];
      if (bitMatch) runtime.bitrate = bitMatch[1];
      if (speedMatch) runtime.speed = speedMatch[1];
      if (frameMatch) runtime.frame = frameMatch[1];
    }
  }
}

function buildFfmpegArgs(stream, localVideoPath, remainingSeconds) {
  const args = ['-hide_banner', '-loglevel', 'info'];

  if (stream.loop) {
    args.push('-stream_loop', '-1');
  }

  args.push('-re', '-i', localVideoPath);

  if (remainingSeconds && remainingSeconds > 0) {
    args.push('-t', String(Math.ceil(remainingSeconds)));
  }

  if (stream.encodeMode === 'copy_explicit') {
    args.push(
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-ar', '44100'
    );
  } else {
    args.push(
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-b:v', '2500k',
      '-maxrate', '2500k',
      '-bufsize', '5000k',
      '-pix_fmt', 'yuv420p',
      '-g', '60',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-ar', '44100'
    );
  }

  const baseRtmp = (stream.rtmpUrl || 'rtmp://a.rtmp.youtube.com/live2').replace(/\/+$/, '');
  const fullRtmpUrl = `${baseRtmp}/${stream.streamKey.trim()}`;

  args.push('-f', 'flv', fullRtmpUrl);
  return args;
}

function startStreamProcess(streamId, isAutoLoopRestart = false) {
  const stream = streams.find(s => s.id === streamId);
  if (!stream) throw new Error('Không tìm thấy luồng.');

  const runtime = getOrCreateRuntime(streamId);
  if (runtime.proc && !isAutoLoopRestart) {
    return;
  }

  runtime.stopRequested = false;
  if (runtime.restartTimer) {
    clearTimeout(runtime.restartTimer);
    runtime.restartTimer = null;
  }

  if (!isAutoLoopRestart) {
    runtime.startedAt = null;
    runtime.fps = '0';
    runtime.bitrate = '0 kbits/s';
    runtime.speed = '0x';
    runtime.frame = '0';
    runtime.loopCount = 0;
    stream.error = null;
  }

  if (stream.fileId) {
    const dlStatus = getDownloadJobStatus(stream.fileId);
    if (!dlStatus || dlStatus.status !== 'completed') {
      stream.status = 'downloading';
      stream.error = null;
      saveStreams();
      appendStreamLog(streamId, `📥 Đang tải video từ Google Drive (ID: ${stream.fileId}) về máy...`);

      ensureDriveVideoDownloaded(stream.fileId, (err, completedJob) => {
        if (runtime.stopRequested) return;
        if (err || completedJob.status === 'error') {
          stream.status = 'error';
          stream.error = err ? err.message : completedJob.error;
          appendStreamLog(streamId, `❌ Lỗi tải video Google Drive: ${stream.error}`);
          saveStreams();
          return;
        }
        appendStreamLog(
          streamId,
          `✅ Tải hoàn tất 100% video "${completedJob.fileName}" (${(completedJob.totalBytes / (1024 * 1024)).toFixed(2)} MB). Bắt đầu phát lên YouTube!`
        );
        launchFfmpegForStream(stream, runtime, completedJob.filePath, isAutoLoopRestart);
      });
      return;
    }

    launchFfmpegForStream(stream, runtime, dlStatus.filePath, isAutoLoopRestart);
  } else {
    launchFfmpegForStream(stream, runtime, stream.driveLink.trim(), isAutoLoopRestart);
  }
}

function launchFfmpegForStream(stream, runtime, inputFilePath, isAutoLoopRestart) {
  const streamId = stream.id;
  if (runtime.stopRequested) return;

  if (!runtime.startedAt || !isAutoLoopRestart) {
    runtime.startedAt = Date.now();
  }

  let remainingSeconds = 0;
  if (stream.durationSeconds > 0) {
    const elapsedSec = (Date.now() - runtime.startedAt) / 1000;
    remainingSeconds = stream.durationSeconds - elapsedSec;
    if (remainingSeconds <= 0) {
      stopStreamProcess(streamId, 'Đã hoàn thành thời lượng live đã cài đặt.');
      return;
    }
  }

  const ffmpegArgs = buildFfmpegArgs(stream, inputFilePath, remainingSeconds);
  const maskedArgs = ffmpegArgs.map(a =>
    a.includes(stream.streamKey) ? a.replace(stream.streamKey, '****-****-****') : a
  );

  appendStreamLog(
    streamId,
    isAutoLoopRestart
      ? `🔄 Tự động lặp lại luồng (Lần lặp #${runtime.loopCount})...`
      : `🚀 Kết nối YouTube RTMP: ${ffmpegPath} ${maskedArgs.join(' ')}`
  );

  stream.status = 'starting';
  stream.error = null;
  if (!isAutoLoopRestart) {
    stream.lastStartedAt = new Date().toISOString();
  }
  saveStreams();

  const proc = spawn(ffmpegPath, ffmpegArgs, {
    windowsHide: true
  });
  runtime.proc = proc;

  if (stream.durationSeconds > 0 && !runtime.durationTimer) {
    runtime.durationTimer = setTimeout(() => {
      appendStreamLog(streamId, `⏱️ Đã hết thời lượng live (${stream.durationSeconds} giây). Tự động dừng luồng.`);
      stopStreamProcess(streamId, null);
    }, stream.durationSeconds * 1000);
  }

  proc.stderr.on('data', (chunk) => {
    const text = chunk.toString('utf8');
    appendStreamLog(streamId, text);
    if (stream.status === 'starting' && (text.includes('fps=') || text.includes('Press [q] to stop'))) {
      stream.status = 'live';
      saveStreams();
    }
  });

  proc.stdout.on('data', (chunk) => {
    appendStreamLog(streamId, chunk.toString('utf8'));
  });

  proc.on('error', (err) => {
    appendStreamLog(streamId, `❌ Lỗi khởi chạy FFmpeg: ${err.message}`);
    stream.status = 'error';
    stream.error = `Lỗi FFmpeg: ${err.message}`;
    runtime.proc = null;
    saveStreams();
  });

  proc.on('close', (code, signal) => {
    runtime.proc = null;

    if (runtime.stopRequested) {
      appendStreamLog(streamId, `⏹️ Luồng đã được dừng bởi người dùng.`);
      stream.status = 'stopped';
      saveStreams();
      return;
    }

    if (stream.durationSeconds > 0) {
      const elapsedSec = (Date.now() - runtime.startedAt) / 1000;
      if (elapsedSec >= stream.durationSeconds - 1) {
        appendStreamLog(streamId, `✅ Luồng đã hoàn thành đủ thời lượng live (${stream.durationSeconds}s).`);
        if (runtime.durationTimer) {
          clearTimeout(runtime.durationTimer);
          runtime.durationTimer = null;
        }
        stream.status = 'stopped';
        saveStreams();
        return;
      }
    }

    if (stream.loop) {
      runtime.loopCount += 1;
      appendStreamLog(
        streamId,
        `🔁 Kết nối lại luồng (Lần #${runtime.loopCount}) sau 2 giây...`
      );
      stream.status = 'starting';
      runtime.restartTimer = setTimeout(() => {
        if (!runtime.stopRequested) {
          startStreamProcess(streamId, true);
        }
      }, 2000);
      return;
    }

    if (code === 0) {
      appendStreamLog(streamId, `✅ Video đã phát xong (Không bật Loop).`);
      stream.status = 'stopped';
    } else {
      appendStreamLog(streamId, `⚠️ FFmpeg dừng với mã lỗi ${code} (signal: ${signal || 'none'}).`);
      stream.status = 'error';
      stream.error = `FFmpeg dừng (Mã: ${code}). Hãy kiểm tra Mã luồng YouTube (Stream Key).`;
    }
    if (runtime.durationTimer) {
      clearTimeout(runtime.durationTimer);
      runtime.durationTimer = null;
    }
    saveStreams();
  });
}

function stopStreamProcess(streamId, customReason = null) {
  const stream = streams.find(s => s.id === streamId);
  if (!stream) return;

  const runtime = activeProcesses.get(streamId);
  if (runtime) {
    runtime.stopRequested = true;
    if (runtime.restartTimer) {
      clearTimeout(runtime.restartTimer);
      runtime.restartTimer = null;
    }
    if (runtime.durationTimer) {
      clearTimeout(runtime.durationTimer);
      runtime.durationTimer = null;
    }
    if (runtime.proc) {
      try {
        runtime.proc.stdin.write('q\n');
      } catch {}
      try {
        runtime.proc.kill('SIGTERM');
      } catch {}
    }
  }

  if (customReason) {
    appendStreamLog(streamId, `ℹ️ ${customReason}`);
  }

  stream.status = 'stopped';
  stream.error = null;
  saveStreams();
}

// ============================================================================
// 3. BACKGROUND SCHEDULER
// ============================================================================

setInterval(() => {
  const now = Date.now();
  for (const stream of streams) {
    if (stream.status === 'scheduled' && stream.scheduledAt) {
      const targetTime = new Date(stream.scheduledAt).getTime();
      if (!isNaN(targetTime) && now >= targetTime) {
        appendStreamLog(stream.id, `⏰ Đã đến giờ hẹn lịch live (${new Date(stream.scheduledAt).toLocaleString('vi-VN')}). Bắt đầu phát!`);
        try {
          startStreamProcess(stream.id, false);
        } catch (err) {
          stream.status = 'error';
          stream.error = err.message;
          saveStreams();
        }
      }
    }
  }
}, 1000);

// ============================================================================
// 4. REST API ENDPOINTS
// ============================================================================

function serializeStream(stream) {
  const runtime = activeProcesses.get(stream.id);
  const isRunning = stream.status === 'live' || stream.status === 'starting';

  let elapsedSeconds = 0;
  let remainingSeconds = null;

  if (isRunning && runtime && runtime.startedAt) {
    elapsedSeconds = Math.max(0, Math.floor((Date.now() - runtime.startedAt) / 1000));
    if (stream.durationSeconds > 0) {
      remainingSeconds = Math.max(0, stream.durationSeconds - elapsedSeconds);
    }
  }

  const dlInfo = stream.fileId ? getDownloadJobStatus(stream.fileId) : null;

  return {
    ...stream,
    elapsedSeconds,
    remainingSeconds,
    fps: isRunning && runtime ? runtime.fps : '0',
    bitrate: isRunning && runtime ? runtime.bitrate : '0 kbits/s',
    speed: isRunning && runtime ? runtime.speed : '0x',
    frame: isRunning && runtime ? runtime.frame : '0',
    loopCount: runtime ? runtime.loopCount : 0,
    downloadInfo: dlInfo
  };
}

app.get('/api/status', (req, res) => {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  const liveCount = streams.filter(
    s => s.status === 'live' || s.status === 'starting' || s.status === 'downloading'
  ).length;
  const scheduledCount = streams.filter(s => s.status === 'scheduled').length;

  res.json({
    serverTime: new Date().toISOString(),
    hostname: os.hostname(),
    isLocalHostViewer: isHostControlAllowed(req),
    platform: `${os.type()} ${os.release()} (${os.arch()})`,
    cpuCores: os.cpus().length,
    cpuModel: os.cpus()[0]?.model || 'Virtual CPU',
    memoryUsedGB: (usedMem / (1024 ** 3)).toFixed(2),
    memoryTotalGB: (totalMem / (1024 ** 3)).toFixed(2),
    memoryPercent: Math.round((usedMem / totalMem) * 100),
    ffmpegReady: Boolean(ffmpegPath),
    ffmpegPath,
    totalStreams: streams.length,
    liveCount,
    scheduledCount,
    share: {
      localUrl: `http://localhost:${PORT}`,
      lanUrls: getLanUrls(),
      tunnelStatus: tunnelState.status,
      publicUrl: tunnelState.publicUrl,
      tunnelError: tunnelState.error
    }
  });
});

app.post('/api/share/restart-tunnel', (req, res) => {
  startPublicTunnel();
  res.json({
    ok: true,
    tunnelStatus: tunnelState.status,
    publicUrl: tunnelState.publicUrl
  });
});

app.post('/api/open-desktop-app', (req, res) => {
  launchDesktopAppWindow();
  res.json({ ok: true });
});

app.get('/api/streams', (req, res) => {
  // If remote visitor hasn't unlocked host control, don't expose host's private stream keys
  if (!isHostControlAllowed(req)) {
    return res.json([]);
  }
  res.json(streams.map(serializeStream));
});

app.get('/api/streams/:id/logs', (req, res) => {
  if (!isHostControlAllowed(req)) {
    return res.status(403).json({ logs: ['Chế độ khách không được phép xem log máy chủ gốc.'] });
  }
  const runtime = activeProcesses.get(req.params.id);
  res.json({
    logs: runtime && runtime.logs.length > 0
      ? runtime.logs
      : ['Chưa có nhật ký hoạt động cho luồng này.']
  });
});

app.post('/api/streams', (req, res) => {
  if (!isHostControlAllowed(req)) {
    return res.status(403).json({
      error: 'Bạn đang mở Link Share trên thiết bị khác. Hãy bấm nút "Tải & Mở App trên máy này" để chạy bằng CPU/RAM của máy bạn (không ăn vào CPU/RAM của máy chủ đã share)!'
    });
  }

  const {
    name,
    streamKey,
    rtmpUrl,
    driveLink,
    loop,
    duration,
    durationUnit,
    scheduledAt,
    encodeMode,
    startImmediately
  } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Vui lòng nhập Tên luồng.' });
  }
  if (!streamKey || !streamKey.trim()) {
    return res.status(400).json({ error: 'Vui lòng nhập Mã luồng (Stream Key).' });
  }
  if (!driveLink || !driveLink.trim()) {
    return res.status(400).json({ error: 'Vui lòng nhập Link Google Drive.' });
  }

  const fileId = extractDriveFileId(driveLink);
  if (!fileId && !/^https?:\/\//i.test(driveLink.trim())) {
    return res.status(400).json({
      error: 'Link Google Drive không hợp lệ. Hãy dán link chia sẻ dạng https://drive.google.com/file/d/.../view'
    });
  }

  const durNum = Number(duration) >= 0 ? Number(duration) : 0;
  const unit = durationUnit || 'minutes';
  const durationSeconds = computeDurationSeconds(durNum, unit);

  const newStream = {
    id: crypto.randomUUID ? crypto.randomUUID() : `stream_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: name.trim(),
    streamKey: streamKey.trim(),
    rtmpUrl: (rtmpUrl || 'rtmp://a.rtmp.youtube.com/live2').trim(),
    driveLink: driveLink.trim(),
    fileId: fileId || null,
    loop: Boolean(loop),
    duration: durNum,
    durationUnit: unit,
    durationSeconds,
    scheduledAt: scheduledAt || null,
    encodeMode: encodeMode || 'transcode',
    status: 'stopped',
    error: null,
    createdAt: new Date().toISOString(),
    lastStartedAt: null
  };

  streams.unshift(newStream);

  if (fileId) {
    ensureDriveVideoDownloaded(fileId);
  }

  if (scheduledAt) {
    const scheduleTime = new Date(scheduledAt).getTime();
    if (!isNaN(scheduleTime) && scheduleTime > Date.now()) {
      newStream.status = 'scheduled';
      appendStreamLog(
        newStream.id,
        `📅 Đã lên lịch phát tự động vào lúc: ${new Date(scheduledAt).toLocaleString('vi-VN')}`
      );
      saveStreams();
      return res.status(201).json(serializeStream(newStream));
    }
  }

  if (startImmediately !== false) {
    startStreamProcess(newStream.id, false);
  } else {
    saveStreams();
  }

  res.status(201).json(serializeStream(newStream));
});

app.put('/api/streams/:id', (req, res) => {
  if (!isHostControlAllowed(req)) {
    return res.status(403).json({ error: 'Không được phép chỉnh sửa luồng của máy chủ gốc.' });
  }
  const stream = streams.find(s => s.id === req.params.id);
  if (!stream) {
    return res.status(404).json({ error: 'Không tìm thấy luồng.' });
  }

  const {
    name,
    streamKey,
    rtmpUrl,
    driveLink,
    loop,
    duration,
    durationUnit,
    scheduledAt,
    encodeMode,
    restartIfRunning
  } = req.body;

  const wasRunning =
    stream.status === 'live' || stream.status === 'starting' || stream.status === 'downloading';
  if (wasRunning && restartIfRunning) {
    stopStreamProcess(stream.id, 'Đang khởi động lại để áp dụng cấu hình mới...');
  }

  if (name !== undefined) stream.name = name.trim();
  if (streamKey !== undefined) stream.streamKey = streamKey.trim();
  if (rtmpUrl !== undefined) stream.rtmpUrl = rtmpUrl.trim();
  if (driveLink !== undefined) {
    stream.driveLink = driveLink.trim();
    stream.fileId = extractDriveFileId(driveLink);
    if (stream.fileId) {
      ensureDriveVideoDownloaded(stream.fileId);
    }
  }
  if (loop !== undefined) stream.loop = Boolean(loop);
  if (duration !== undefined || durationUnit !== undefined) {
    stream.duration = Number(duration) >= 0 ? Number(duration) : 0;
    stream.durationUnit = durationUnit || stream.durationUnit || 'minutes';
    stream.durationSeconds = computeDurationSeconds(stream.duration, stream.durationUnit);
  }
  if (scheduledAt !== undefined) {
    stream.scheduledAt = scheduledAt || null;
    if (scheduledAt && new Date(scheduledAt).getTime() > Date.now() && !wasRunning) {
      stream.status = 'scheduled';
    } else if (!scheduledAt && stream.status === 'scheduled') {
      stream.status = 'stopped';
    }
  }
  if (encodeMode !== undefined) stream.encodeMode = encodeMode;

  saveStreams();

  if (wasRunning && restartIfRunning) {
    setTimeout(() => startStreamProcess(stream.id, false), 500);
  }

  res.json(serializeStream(stream));
});

app.post('/api/streams/:id/start', (req, res) => {
  if (!isHostControlAllowed(req)) {
    return res.status(403).json({ error: 'Vui lòng mở App trên máy của bạn để dùng CPU/RAM máy bạn.' });
  }
  const stream = streams.find(s => s.id === req.params.id);
  if (!stream) {
    return res.status(404).json({ error: 'Không tìm thấy luồng.' });
  }
  startStreamProcess(stream.id, false);
  res.json(serializeStream(stream));
});

app.post('/api/streams/:id/stop', (req, res) => {
  if (!isHostControlAllowed(req)) {
    return res.status(403).json({ error: 'Không được phép dừng luồng của máy chủ gốc.' });
  }
  const stream = streams.find(s => s.id === req.params.id);
  if (!stream) {
    return res.status(404).json({ error: 'Không tìm thấy luồng.' });
  }
  stopStreamProcess(stream.id, 'Đã hủy / dừng luồng theo yêu cầu.');
  res.json(serializeStream(stream));
});

app.delete('/api/streams/:id', (req, res) => {
  if (!isHostControlAllowed(req)) {
    return res.status(403).json({ error: 'Không được phép xóa luồng của máy chủ gốc.' });
  }
  const idx = streams.findIndex(s => s.id === req.params.id);
  if (idx === -1) {
    return res.status(404).json({ error: 'Không tìm thấy luồng.' });
  }
  stopStreamProcess(req.params.id);
  activeProcesses.delete(req.params.id);
  streams.splice(idx, 1);
  saveStreams();
  res.json({ ok: true });
});

app.post('/api/streams/start-all', (req, res) => {
  if (!isHostControlAllowed(req)) {
    return res.status(403).json({ error: 'Không được phép điều khiển máy chủ gốc.' });
  }
  let started = 0;
  for (const s of streams) {
    if (s.status !== 'live' && s.status !== 'starting' && s.status !== 'downloading') {
      startStreamProcess(s.id, false);
      started++;
    }
  }
  res.json({ ok: true, started });
});

app.post('/api/streams/stop-all', (req, res) => {
  if (!isHostControlAllowed(req)) {
    return res.status(403).json({ error: 'Không được phép điều khiển máy chủ gốc.' });
  }
  let stopped = 0;
  for (const s of streams) {
    if (['live', 'starting', 'downloading', 'scheduled'].includes(s.status)) {
      stopStreamProcess(s.id, 'Dừng hàng loạt tất cả các luồng.');
      stopped++;
    }
  }
  res.json({ ok: true, stopped });
});

function launchDesktopAppWindow() {
  if (process.platform !== 'win32') return;
  const appUrl = `http://localhost:${PORT}`;
  const edgePaths = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ];
  const chromePaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ];

  let browserBin = [...edgePaths, ...chromePaths].find(p => fs.existsSync(p));
  if (browserBin) {
    spawn(browserBin, [`--app=${appUrl}`, '--window-size=1380,860'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false
    }).unref();
  } else {
    spawn('cmd.exe', ['/c', 'start', '', appUrl], {
      detached: true,
      stdio: 'ignore'
    }).unref();
  }
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`============================================================`);
  console.log(`🎥 YouTube Multi-Stream Manager (Chạy độc lập trên từng máy)`);
  console.log(`💻 Local App URL : http://localhost:${PORT}`);
  console.log(`⚙️  FFmpeg Binary : ${ffmpegPath}`);
  console.log(`============================================================`);

  startPublicTunnel();

  for (const s of streams) {
    if (s.wasRunningBeforeRestart) {
      delete s.wasRunningBeforeRestart;
      console.log(`🔄 Khôi phục luồng đang phát: ${s.name}`);
      startStreamProcess(s.id, false);
    }
  }

  if (process.argv.includes('--desktop')) {
    launchDesktopAppWindow();
  }
});

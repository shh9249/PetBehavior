// API配置
const API_BASE_URL = 'http://localhost:5000/api';

// DOM元素
const chatMessages = document.getElementById('chatMessages');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const uploadBtn = document.getElementById('uploadBtn');
const videoInput = document.getElementById('videoInput');
const filePreview = document.getElementById('filePreview');
const statusIndicator = document.getElementById('statusIndicator');
const statusText = document.getElementById('statusText');

// 状态
let selectedFile = null;
let isProcessing = false;

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    checkServerHealth();
    setupEventListeners();
    adjustTextareaHeight();
});

// 检查服务器健康状态
async function checkServerHealth() {
    try {
        const response = await fetch(`${API_BASE_URL}/health`);
        if (response.ok) {
            updateStatus('connected', '已连接');
        } else {
            updateStatus('error', '连接失败');
        }
    } catch (error) {
        updateStatus('error', '服务器离线');
        console.error('服务器连接失败:', error);
    }
}

// 更新连接状态
function updateStatus(status, text) {
    statusIndicator.className = `status-indicator ${status}`;
    statusText.textContent = text;
}

// 设置事件监听器
function setupEventListeners() {
    // 发送按钮
    sendBtn.addEventListener('click', handleSend);
    
    // 输入框回车发送
    messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    });
    
    // 输入框自动调整高度
    messageInput.addEventListener('input', () => {
        adjustTextareaHeight();
        updateSendButton();
    });
    
    // 上传按钮
    uploadBtn.addEventListener('click', () => {
        videoInput.click();
    });
    
    // 文件选择
    videoInput.addEventListener('change', handleFileSelect);
}

// 自动调整文本框高度
function adjustTextareaHeight() {
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
}

// 更新发送按钮状态
function updateSendButton() {
    const hasContent = messageInput.value.trim() !== '' || selectedFile !== null;
    sendBtn.disabled = !hasContent || isProcessing;
}

// 处理文件选择
function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    // 检查文件类型
    if (!file.type.startsWith('video/')) {
        showErrorMessage('请选择视频文件');
        return;
    }
    
    // 检查文件大小 (100MB)
    if (file.size > 100 * 1024 * 1024) {
        showErrorMessage('文件大小不能超过100MB');
        return;
    }
    
    selectedFile = file;
    showFilePreview(file);
    updateSendButton();
}

// 显示文件预览
function showFilePreview(file) {
    filePreview.innerHTML = `
        <div class="file-preview-icon">🎥</div>
        <div class="file-preview-text">
            <div class="file-preview-name">${file.name}</div>
            <div>${formatFileSize(file.size)}</div>
        </div>
        <button class="file-remove" onclick="removeFile()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
        </button>
    `;
    filePreview.classList.add('active');
}

// 移除文件
function removeFile() {
    selectedFile = null;
    videoInput.value = '';
    filePreview.classList.remove('active');
    filePreview.innerHTML = '';
    updateSendButton();
}

// 格式化文件大小
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// 处理发送
async function handleSend() {
    if (isProcessing) return;
    
    const message = messageInput.value.trim();
    
    // 验证输入
    if (!message && !selectedFile) {
        return;
    }
    
    isProcessing = true;
    updateSendButton();
    
    try {
        if (selectedFile) {
            // 有文件：发送文件和消息
            await sendVideoMessage(message, selectedFile);
        } else {
            // 仅文本消息
            await sendTextMessage(message);
        }
        
        // 清空输入
        messageInput.value = '';
        removeFile();
        adjustTextareaHeight();
        
    } catch (error) {
        console.error('发送失败:', error);
        showErrorMessage('发送失败，请重试');
    } finally {
        isProcessing = false;
        updateSendButton();
    }
}

// 发送文本消息
async function sendTextMessage(message) {
    // 显示用户消息
    addMessage('user', message);
    
    // 显示加载动画
    const loadingId = addLoadingMessage();
    
    try {
        const response = await fetch(`${API_BASE_URL}/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ message }),
        });
        
        const data = await response.json();
        
        // 移除加载动画
        removeLoadingMessage(loadingId);
        
        if (data.success) {
            addMessage('assistant', data.response);
        } else {
            throw new Error(data.error || '未知错误');
        }
    } catch (error) {
        removeLoadingMessage(loadingId);
        throw error;
    }
}

// 发送视频消息
// 发送视频消息
async function sendVideoMessage(message, file) {
    // 显示用户消息（包含视频预览）
    const userMessage = message || '发送了一个视频';
    addMessage('user', userMessage, {
        type: 'video',
        name: file.name,
        size: file.size
    });
    
    // 显示加载动画
    const loadingId = addLoadingMessage('正在上传和分析视频...');
    
    try {
        const formData = new FormData();
        formData.append('video', file);
        formData.append('message', message);
        
        
        const response = await fetch(`${API_BASE_URL}/upload`, {
            method: 'POST',
            body: formData,
        });
        
        const data = await response.json();
        
        // 移除加载动画
        removeLoadingMessage(loadingId);
        
        if (data.success) {
            // 添加AI响应（包含视频预览）
            addMessage('assistant', data.response, {
                type: 'video',
                name: data.filename,
                size: data.filesize,
                serverFilename: data.filename
            });
        } else {
            throw new Error(data.error || '上传失败');
        }
    } catch (error) {
        removeLoadingMessage(loadingId);
        throw error;
    }
}

        
// 添加消息到聊天界面
function addMessage(type, text, attachment = null) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}-message`;
    
    const avatarSVG = type === 'user' 
        ? '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle>'
        : '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/>';
    
    const timeString = new Date().toLocaleTimeString('zh-CN', { 
        hour: '2-digit', 
        minute: '2-digit' 
    });
    
    let messageHTML = text.replace(/\n/g, '<br>');
    
    // 处理视频附件
    if (attachment && attachment.type === 'video') {
        const videoHTML = createVideoThumbnail(attachment);
        messageHTML = `${messageHTML}<br>${videoHTML}`;
    } else if (attachment && attachment.name) {
        // 兼容旧的文件显示方式
        messageHTML = `<div style="margin-bottom: 0.5rem;"><strong>📎 ${attachment.name}</strong></div>${messageHTML}`;
    }
    
    messageDiv.innerHTML = `
        <div class="message-avatar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                ${avatarSVG}
            </svg>
        </div>
        <div class="message-content">
            <div class="message-text">${messageHTML}</div>
            <div class="message-time">${timeString}</div>
        </div>
    `;
    
    chatMessages.appendChild(messageDiv);
    scrollToBottom();
}


// 添加加载消息
function addLoadingMessage(text = '正在思考...') {
    const loadingId = 'loading-' + Date.now();
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message assistant-message';
    messageDiv.id = loadingId;
    
    messageDiv.innerHTML = `
        <div class="message-avatar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/>
            </svg>
        </div>
        <div class="message-content">
            <div class="loading-message">
                <div class="loading-dot"></div>
                <div class="loading-dot"></div>
                <div class="loading-dot"></div>
            </div>
            ${text !== '正在思考...' ? `<div class="message-time" style="margin-top: 0.5rem; color: var(--text-secondary);">${text}</div>` : ''}
        </div>
    `;
    
    chatMessages.appendChild(messageDiv);
    scrollToBottom();
    
    return loadingId;
}

// 移除加载消息
function removeLoadingMessage(loadingId) {
    const loadingElement = document.getElementById(loadingId);
    if (loadingElement) {
        loadingElement.remove();
    }
}

// 显示错误消息
function showErrorMessage(message) {
    addMessage('assistant', `❌ ${message}`);
}

// 滚动到底部
function scrollToBottom() {
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// 格式化时间
function formatTime(date) {
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
}

// 使removeFile函数全局可用
window.removeFile = removeFile;

// 创建视频缩略图
function createVideoThumbnail(videoData) {
    const { name, size, serverFilename } = videoData;
    const displayName = name || serverFilename;
    const fileSize = formatFileSize(size);
    
    // 使用服务器文件名（如果有的话）
    const filename = serverFilename || name;
    
    return `
        <div class="video-thumbnail" onclick="playVideo('${filename}', '${displayName}', '${fileSize}')">
            <div class="video-thumbnail-icon">🎥</div>
            <div class="video-thumbnail-info">
                <div class="video-thumbnail-name">${displayName}</div>
                <div class="video-thumbnail-size">${fileSize} • 点击播放</div>
            </div>
        </div>
    `;
}

// 播放视频
function playVideo(filename, displayName, fileSize) {
    const videoModal = document.getElementById('videoModal');
    const videoPlayer = document.getElementById('videoPlayer');
    const videoSource = document.getElementById('videoSource');
    const videoModalTitle = document.getElementById('videoModalTitle');
    const videoInfo = document.getElementById('videoInfo');
    
    // 设置视频源
    const videoUrl = `${API_BASE_URL}/video/${filename}`;
    videoSource.src = videoUrl;
    videoPlayer.load();
    
    // 设置标题和信息
    videoModalTitle.textContent = displayName;
    videoInfo.innerHTML = `
        <div class="video-info-item">
            <span class="video-info-label">文件名：</span>
            <span>${displayName}</span>
        </div>
        <div class="video-info-item">
            <span class="video-info-label">大小：</span>
            <span>${fileSize}</span>
        </div>
    `;
    
    // 显示模态框
    videoModal.classList.add('active');
    
    // 阻止背景滚动
    document.body.style.overflow = 'hidden';
    
    // 自动播放（可选）
    videoPlayer.play().catch(error => {
        console.log('自动播放失败:', error);
    });
}

// 关闭视频播放器
function closeVideoModal() {
    const videoModal = document.getElementById('videoModal');
    const videoPlayer = document.getElementById('videoPlayer');
    
    // 暂停并重置视频
    videoPlayer.pause();
    videoPlayer.currentTime = 0;
    
    // 隐藏模态框
    videoModal.classList.remove('active');
    
    // 恢复背景滚动
    document.body.style.overflow = 'auto';
}

// 键盘ESC关闭视频
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const videoModal = document.getElementById('videoModal');
        if (videoModal.classList.contains('active')) {
            closeVideoModal();
        }
    }
});

// 使函数全局可用
window.playVideo = playVideo;
window.closeVideoModal = closeVideoModal;

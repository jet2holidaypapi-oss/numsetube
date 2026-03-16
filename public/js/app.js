// ===== STATE =====
let currentUser = null;
let currentVideo = null;
let currentChatPartnerId = null;
let messageInterval = null;

// ===== INIT =====
document.addEventListener('DOMContentLoaded', async () => {
  await checkAuth();
  navigate('home');
  if (currentUser) startMessagePolling();
  document.getElementById('search-input').addEventListener('keydown', e => { if (e.key === 'Enter') searchVideos(); });
  document.getElementById('comment-input').addEventListener('focus', () => document.getElementById('comment-actions').classList.remove('hidden'));
});

// ===== AUTH =====
async function checkAuth() {
  const res = await api('/api/me');
  currentUser = res.user;
  updateAuthUI();
}

function updateAuthUI() {
  const authBtns = document.getElementById('auth-btns');
  const userMenu = document.getElementById('user-menu');
  if (currentUser) {
    authBtns.classList.add('hidden');
    userMenu.classList.remove('hidden');
    document.getElementById('nav-avatar').textContent = currentUser.username[0].toUpperCase();
    document.getElementById('nav-avatar').style.background = hashColor(currentUser.username);
    document.querySelector('.dropdown-user').textContent = currentUser.username;
    // Admin UI
    const isAdm = currentUser.is_admin === 1 || currentUser.username === 'Papi';
    document.getElementById('admin-badge-nav').classList.toggle('hidden', !isAdm);
    document.getElementById('admin-panel-link').classList.toggle('hidden', !isAdm);
    document.getElementById('sidebar-admin').classList.toggle('hidden', !isAdm);
  } else {
    authBtns.classList.remove('hidden');
    userMenu.classList.add('hidden');
  }
}

async function submitLogin() {
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  errEl.classList.add('hidden');
  if (!username || !password) { errEl.textContent = 'Please fill in all fields'; errEl.classList.remove('hidden'); return; }
  const res = await api('/api/login', { method: 'POST', body: { username, password } });
  if (res.error) { errEl.textContent = res.error; errEl.classList.remove('hidden'); return; }
  currentUser = res.user;
  updateAuthUI();
  closeAllModals();
  toast('Welcome back, ' + currentUser.username + '!');
  startMessagePolling();
}

async function submitRegister() {
  const username = document.getElementById('reg-username').value.trim();
  const password = document.getElementById('reg-password').value;
  const errEl = document.getElementById('reg-error');
  errEl.classList.add('hidden');
  if (!username || !password) { errEl.textContent = 'Please fill in all fields'; errEl.classList.remove('hidden'); return; }
  const res = await api('/api/register', { method: 'POST', body: { username, password } });
  if (res.error) { errEl.textContent = res.error; errEl.classList.remove('hidden'); return; }
  currentUser = res.user;
  updateAuthUI();
  closeAllModals();
  toast('Welcome to ViewTube, ' + currentUser.username + '!');
  startMessagePolling();
}

async function logout() {
  await api('/api/logout', { method: 'POST' });
  currentUser = null;
  stopMessagePolling();
  updateAuthUI();
  navigate('home');
  toast('Signed out');
}

// ===== NAVIGATION =====
function navigate(page, data) {
  document.querySelectorAll('.page').forEach(p => { p.style.display = 'none'; p.classList.remove('active'); });
  document.querySelectorAll('.sidebar-item').forEach(s => s.classList.remove('active'));
  closeDropdowns();

  const pageEl = document.getElementById('page-' + page);
  if (!pageEl) return;
  pageEl.style.display = 'block';
  pageEl.classList.add('active');

  const sidebarItem = document.querySelector(`.sidebar-item[onclick*="'${page}'"]`);
  if (sidebarItem) sidebarItem.classList.add('active');

  switch (page) {
    case 'home': loadHomeVideos(); break;
    case 'upload': if (!currentUser) { showModal('login-modal'); return; } break;
    case 'watch': loadWatchPage(data); break;
    case 'messages':
      if (!currentUser) { showModal('login-modal'); return; }
      loadConversations();
      if (data) openConversation(data);
      break;
    case 'profile': loadProfile(data); break;
    case 'profile-self':
      if (!currentUser) { showModal('login-modal'); return; }
      loadProfile(currentUser.id);
      break;
    case 'search': loadSearchPage(data); break;
    case 'admin':
      if (!currentUser || (currentUser.is_admin !== 1 && currentUser.username !== 'Papi')) { toast('Admin only'); navigate('home'); return; }
      loadAdminPanel();
      break;
  }
}

// ===== HOME =====
async function loadHomeVideos() {
  const res = await api('/api/videos?limit=30');
  const grid = document.getElementById('home-grid');
  const empty = document.getElementById('home-empty');
  grid.innerHTML = '';
  if (!res.videos?.length) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  res.videos.forEach(v => grid.appendChild(createVideoCard(v)));
}

// ===== VIDEO CARDS =====
function createVideoCard(v) {
  const card = document.createElement('div');
  card.className = 'video-card';
  card.onclick = () => navigate('watch', v.id);
  const thumbSrc = v.thumbnail ? `/thumbnails/${v.thumbnail}` : null;
  const adminBadge = (v.is_admin === 1 || v.username === 'Papi') ? '<span class="admin-tag" style="font-size:0.7rem;margin-left:4px;">👑</span>' : '';
  card.innerHTML = `
    <div class="video-thumb">
      ${thumbSrc
        ? `<img src="${thumbSrc}" alt="${esc(v.title)}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=video-thumb-placeholder>▶</div>'">`
        : `<div class="video-thumb-placeholder">▶</div>`}
    </div>
    <div class="video-card-info">
      <div class="video-card-channel">${esc(v.username)}${adminBadge}</div>
      <div class="video-card-title">${esc(v.title)}</div>
      <div class="video-card-meta">${formatViews(v.views)} views · ${timeAgo(v.created_at)}</div>
    </div>
  `;
  return card;
}

function createRelatedCard(v) {
  const card = document.createElement('div');
  card.className = 'related-card';
  card.onclick = () => navigate('watch', v.id);
  const thumbSrc = v.thumbnail ? `/thumbnails/${v.thumbnail}` : null;
  card.innerHTML = `
    <div class="related-thumb">
      ${thumbSrc
        ? `<img src="${thumbSrc}" alt="${esc(v.title)}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=related-thumb-placeholder>▶</div>'">`
        : `<div class="related-thumb-placeholder">▶</div>`}
    </div>
    <div class="related-info">
      <div class="related-title">${esc(v.title)}</div>
      <div class="related-channel">${esc(v.username)}</div>
      <div class="related-channel">${formatViews(v.views)} views</div>
    </div>
  `;
  return card;
}

// ===== WATCH PAGE =====
async function loadWatchPage(videoId) {
  if (!videoId) return;
  const res = await api(`/api/videos/${videoId}`);
  if (res.error) { toast('Video not found'); navigate('home'); return; }
  const { video, likes, userLike, subCount, isSubbed, viewerIsAdmin } = res;
  currentVideo = video;

  document.getElementById('video-player').src = `/uploads/${video.filename}`;
  document.getElementById('watch-title').textContent = video.title;
  document.getElementById('watch-views').textContent = formatViews(video.views) + ' views';
  document.getElementById('watch-date').textContent = timeAgo(video.created_at);
  document.getElementById('watch-description').textContent = video.description || 'No description.';
  document.getElementById('watch-channel-name').textContent = video.username;
  document.getElementById('watch-channel-avatar').textContent = video.username[0].toUpperCase();
  document.getElementById('watch-channel-avatar').style.background = hashColor(video.username);
  document.getElementById('watch-sub-count').textContent = formatViews(subCount) + ' subscribers';

  const adminTag = document.getElementById('watch-channel-admin-tag');
  if (video.is_admin === 1 || video.username === 'Papi') adminTag.classList.remove('hidden');
  else adminTag.classList.add('hidden');

  updateLikeButtons(likes, userLike);

  const subBtn = document.getElementById('subscribe-btn');
  if (!currentUser || currentUser.id === video.user_id) subBtn.classList.add('hidden');
  else {
    subBtn.classList.remove('hidden');
    subBtn.textContent = isSubbed ? 'Subscribed ✓' : 'Subscribe';
    subBtn.classList.toggle('subscribed', isSubbed);
  }

  const msgBtn = document.getElementById('message-creator-btn');
  if (!currentUser || currentUser.id === video.user_id) msgBtn.classList.add('hidden');
  else msgBtn.classList.remove('hidden');

  // Admin delete button
  const adminDeleteBtn = document.getElementById('admin-delete-video-btn');
  if (viewerIsAdmin && currentUser?.id !== video.user_id) adminDeleteBtn.classList.remove('hidden');
  else adminDeleteBtn.classList.add('hidden');

  const commentAvatar = document.getElementById('comment-user-avatar');
  if (currentUser) {
    commentAvatar.textContent = currentUser.username[0].toUpperCase();
    commentAvatar.style.background = hashColor(currentUser.username);
    document.getElementById('comment-form-wrap').classList.remove('hidden');
  } else {
    document.getElementById('comment-form-wrap').classList.add('hidden');
  }

  loadComments(videoId);
  loadRelatedVideos(videoId);
}

function updateLikeButtons(likes, userLike) {
  const likeCount = likes.find(l => l.type === 'like')?.count || 0;
  const dislikeCount = likes.find(l => l.type === 'dislike')?.count || 0;
  document.getElementById('like-count').textContent = likeCount;
  document.getElementById('dislike-count').textContent = dislikeCount;
  document.getElementById('like-btn').classList.toggle('active', userLike?.type === 'like');
  document.getElementById('dislike-btn').classList.toggle('active', userLike?.type === 'dislike');
}

async function likeVideo(type) {
  if (!currentUser) { showModal('login-modal'); return; }
  const res = await api(`/api/videos/${currentVideo.id}/like`, { method: 'POST', body: { type } });
  if (res.likes) updateLikeButtons(res.likes, res.userLike);
}

async function toggleSubscribe() {
  if (!currentUser) { showModal('login-modal'); return; }
  const res = await api(`/api/channels/${currentVideo.user_id}/subscribe`, { method: 'POST' });
  const btn = document.getElementById('subscribe-btn');
  btn.textContent = res.subscribed ? 'Subscribed ✓' : 'Subscribe';
  btn.classList.toggle('subscribed', res.subscribed);
  toast(res.subscribed ? 'Subscribed!' : 'Unsubscribed');
}

async function adminDeleteVideo() {
  if (!confirm('Delete this video? This cannot be undone.')) return;
  const res = await api(`/api/videos/${currentVideo.id}`, { method: 'DELETE' });
  if (res.success) { toast('Video deleted'); navigate('home'); }
  else toast(res.error || 'Failed to delete');
}

function viewChannel() { if (currentVideo) navigate('profile', currentVideo.user_id); }
function messageCreator() {
  if (!currentUser) { showModal('login-modal'); return; }
  navigate('messages', currentVideo.user_id);
}

async function loadRelatedVideos() {
  const res = await api('/api/videos?limit=10');
  const container = document.getElementById('related-videos');
  container.innerHTML = '';
  res.videos?.filter(v => v.id !== currentVideo?.id).forEach(v => container.appendChild(createRelatedCard(v)));
}

// ===== COMMENTS =====
async function loadComments(videoId) {
  const res = await api(`/api/videos/${videoId}/comments`);
  const list = document.getElementById('comments-list');
  const countEl = document.getElementById('comments-count');
  list.innerHTML = '';
  countEl.textContent = `${res.comments?.length || 0} Comments`;
  res.comments?.forEach(c => list.appendChild(createCommentEl(c)));
}

function createCommentEl(c) {
  const el = document.createElement('div');
  el.className = 'comment-item';
  el.id = 'comment-' + c.id;
  const isAdminComment = c.is_admin === 1 || c.username === 'Papi';
  const canDelete = currentUser?.id === c.user_id || (currentUser && (currentUser.is_admin === 1 || currentUser.username === 'Papi'));
  el.innerHTML = `
    <div class="avatar" style="background:${hashColor(c.username)}">${c.username[0].toUpperCase()}</div>
    <div class="comment-content">
      <div class="comment-meta">
        <span class="comment-author">${esc(c.username)}</span>
        ${isAdminComment ? '<span class="admin-tag" style="font-size:0.7rem;">👑 Admin</span>' : ''}
        <span class="comment-time">${timeAgo(c.created_at)}</span>
        ${canDelete ? `<button class="comment-delete" onclick="deleteComment('${c.id}')">✕ Delete</button>` : ''}
      </div>
      <div class="comment-text">${esc(c.text)}</div>
    </div>
  `;
  return el;
}

function cancelComment() {
  document.getElementById('comment-input').value = '';
  document.getElementById('comment-actions').classList.add('hidden');
}

async function submitComment() {
  const input = document.getElementById('comment-input');
  const text = input.value.trim();
  if (!text) return;
  if (!currentUser) { showModal('login-modal'); return; }
  const res = await api(`/api/videos/${currentVideo.id}/comments`, { method: 'POST', body: { text } });
  if (res.comment) {
    document.getElementById('comments-list').prepend(createCommentEl(res.comment));
    input.value = '';
    cancelComment();
    const countEl = document.getElementById('comments-count');
    const count = parseInt(countEl.textContent) + 1;
    countEl.textContent = `${count} Comments`;
  }
}

async function deleteComment(commentId) {
  await api(`/api/comments/${commentId}`, { method: 'DELETE' });
  document.getElementById('comment-' + commentId)?.remove();
  toast('Comment deleted');
}

// ===== UPLOAD =====
let selectedVideoFile = null;
let selectedThumbFile = null;

function handleDrop(e) {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('video/')) setVideoFile(file);
}
function handleFileSelect(e) { const file = e.target.files[0]; if (file) setVideoFile(file); }
function setVideoFile(file) {
  selectedVideoFile = file;
  const preview = document.getElementById('upload-video-preview');
  preview.src = URL.createObjectURL(file);
  document.getElementById('upload-preview').classList.remove('hidden');
  document.getElementById('upload-drop-zone').classList.add('hidden');
  if (!document.getElementById('upload-title').value)
    document.getElementById('upload-title').value = file.name.replace(/\.[^.]+$/, '');
}
function previewThumb(e) {
  selectedThumbFile = e.target.files[0];
  if (selectedThumbFile) {
    const img = document.getElementById('thumb-preview');
    img.src = URL.createObjectURL(selectedThumbFile);
    img.classList.remove('hidden');
  }
}

async function submitUpload() {
  if (!currentUser) { showModal('login-modal'); return; }
  if (!selectedVideoFile) { toast('Please select a video file'); return; }
  const title = document.getElementById('upload-title').value.trim();
  if (!title) { toast('Please enter a title'); return; }

  const formData = new FormData();
  formData.append('video', selectedVideoFile);
  formData.append('title', title);
  formData.append('description', document.getElementById('upload-description').value);
  if (selectedThumbFile) formData.append('thumbnail', selectedThumbFile);

  const progressWrap = document.getElementById('upload-progress-wrap');
  const progressBar = document.getElementById('upload-progress');
  const progressText = document.getElementById('upload-progress-text');
  const submitBtn = document.getElementById('upload-submit-btn');
  progressWrap.classList.remove('hidden');
  submitBtn.disabled = true;

  try {
    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        progressBar.style.width = pct + '%';
        progressText.textContent = `Uploading... ${pct}%`;
      }
    };
    const res = await new Promise((resolve, reject) => {
      xhr.onload = () => resolve(JSON.parse(xhr.responseText));
      xhr.onerror = reject;
      xhr.open('POST', '/api/videos/upload-with-thumb');
      xhr.send(formData);
    });
    if (res.videoId) {
      toast('Video uploaded!');
      selectedVideoFile = null; selectedThumbFile = null;
      document.getElementById('upload-title').value = '';
      document.getElementById('upload-description').value = '';
      document.getElementById('upload-video-preview').src = '';
      document.getElementById('upload-preview').classList.add('hidden');
      document.getElementById('upload-drop-zone').classList.remove('hidden');
      document.getElementById('thumb-preview').classList.add('hidden');
      navigate('watch', res.videoId);
    } else toast(res.error || 'Upload failed');
  } catch (e) {
    toast('Upload failed: ' + e.message);
  } finally {
    progressWrap.classList.add('hidden');
    submitBtn.disabled = false;
    progressBar.style.width = '0%';
  }
}

// ===== MESSAGES =====
async function loadConversations() {
  const res = await api('/api/messages/conversations');
  const list = document.getElementById('conversations-list');
  const empty = document.getElementById('conversations-empty');
  list.innerHTML = '';
  if (!res.conversations?.length) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  res.conversations.forEach(c => list.appendChild(createConvoEl(c)));
  updateUnreadBadge();
}

function createConvoEl(c) {
  const el = document.createElement('div');
  el.className = 'conversation-item';
  el.id = 'convo-' + c.other_id;
  if (currentChatPartnerId === c.other_id) el.classList.add('active');
  el.onclick = () => openConversation(c.other_id);
  el.innerHTML = `
    <div class="avatar" style="background:${hashColor(c.other_username)}">${c.other_username[0].toUpperCase()}</div>
    <div class="convo-info">
      <div class="convo-name">${esc(c.other_username)} ${c.unread > 0 ? `<span class="badge">${c.unread}</span>` : ''}</div>
      <div class="convo-last">${esc(c.last_message || '')}</div>
    </div>
  `;
  return el;
}

async function openConversation(userId) {
  currentChatPartnerId = userId;
  document.querySelectorAll('.conversation-item').forEach(i => i.classList.remove('active'));
  document.getElementById('convo-' + userId)?.classList.add('active');

  const res = await api(`/api/messages/${userId}`);
  document.getElementById('chat-placeholder').classList.add('hidden');
  document.getElementById('chat-active').classList.remove('hidden');

  const convoEl = document.getElementById('convo-' + userId);
  const partnerName = convoEl?.querySelector('.convo-name')?.textContent?.trim().split(' ')[0] || 'User';
  document.getElementById('chat-partner-name').textContent = partnerName;
  document.getElementById('chat-partner-avatar').textContent = partnerName[0].toUpperCase();
  document.getElementById('chat-partner-avatar').style.background = hashColor(partnerName);

  const chatMsgs = document.getElementById('chat-messages');
  chatMsgs.innerHTML = '';
  res.messages?.forEach(m => chatMsgs.appendChild(createMessageEl(m)));
  chatMsgs.scrollTop = chatMsgs.scrollHeight;
  loadConversations();
}

function createMessageEl(m) {
  const el = document.createElement('div');
  const isMine = m.sender_id === currentUser.id;
  el.className = 'msg-bubble-wrap' + (isMine ? ' mine' : '');
  el.innerHTML = `<div class="msg-bubble">${esc(m.text)}</div>`;
  return el;
}

async function sendMessage() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text || !currentChatPartnerId) return;
  input.value = '';
  await api(`/api/messages/${currentChatPartnerId}`, { method: 'POST', body: { text } });
  const res2 = await api(`/api/messages/${currentChatPartnerId}`);
  const chatMsgs = document.getElementById('chat-messages');
  chatMsgs.innerHTML = '';
  res2.messages?.forEach(m => chatMsgs.appendChild(createMessageEl(m)));
  chatMsgs.scrollTop = chatMsgs.scrollHeight;
  loadConversations();
}

async function updateUnreadBadge() {
  const res = await api('/api/messages/conversations');
  const total = res.conversations?.reduce((s, c) => s + (c.unread || 0), 0) || 0;
  const badge = document.getElementById('unread-badge');
  if (total > 0) { badge.textContent = total; badge.classList.remove('hidden'); }
  else badge.classList.add('hidden');
}
function startMessagePolling() { messageInterval = setInterval(updateUnreadBadge, 30000); }
function stopMessagePolling() { if (messageInterval) { clearInterval(messageInterval); messageInterval = null; } }

// ===== PROFILE =====
let profileData = null;
async function loadProfile(userId) {
  const res = await api(`/api/users/${userId}`);
  if (res.error) { toast('Profile not found'); navigate('home'); return; }
  profileData = res;
  const { user, videos, subCount } = res;

  document.getElementById('profile-avatar').textContent = user.username[0].toUpperCase();
  document.getElementById('profile-avatar').style.background = hashColor(user.username);
  document.getElementById('profile-username').textContent = user.username;
  document.getElementById('profile-sub-count').textContent = formatViews(subCount) + ' subscribers';
  document.getElementById('profile-bio').textContent = user.bio || '';

  const adminTag = document.getElementById('profile-admin-tag');
  if (user.is_admin === 1 || user.username === 'Papi') adminTag.classList.remove('hidden');
  else adminTag.classList.add('hidden');

  const subBtn = document.getElementById('profile-subscribe-btn');
  const msgBtn = document.getElementById('profile-message-btn');
  if (!currentUser || currentUser.id === user.id) { subBtn.classList.add('hidden'); msgBtn.classList.add('hidden'); }
  else { subBtn.classList.remove('hidden'); msgBtn.classList.remove('hidden'); subBtn.textContent = 'Subscribe'; }

  const grid = document.getElementById('profile-videos');
  grid.innerHTML = '';
  videos.forEach(v => grid.appendChild(createVideoCard({ ...v, username: user.username, is_admin: user.is_admin })));
}

async function toggleSubscribeProfile() {
  if (!currentUser || !profileData) return;
  const res = await api(`/api/channels/${profileData.user.id}/subscribe`, { method: 'POST' });
  document.getElementById('profile-subscribe-btn').textContent = res.subscribed ? 'Subscribed ✓' : 'Subscribe';
  toast(res.subscribed ? 'Subscribed!' : 'Unsubscribed');
}
function messageProfileUser() {
  if (!currentUser || !profileData) return;
  navigate('messages', profileData.user.id);
}

// ===== SEARCH =====
function searchVideos() {
  const query = document.getElementById('search-input').value.trim();
  if (!query) return;
  navigate('search', query);
}
async function loadSearchPage(query) {
  document.getElementById('search-query-display').textContent = query;
  const res = await api(`/api/videos?search=${encodeURIComponent(query)}&limit=30`);
  const grid = document.getElementById('search-grid');
  const empty = document.getElementById('search-empty');
  grid.innerHTML = '';
  if (!res.videos?.length) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  res.videos.forEach(v => grid.appendChild(createVideoCard(v)));
}

// ===== ADMIN PANEL =====
async function loadAdminPanel() {
  loadAdminVideos();
}

async function loadAdminVideos() {
  const res = await api('/api/videos?limit=100');
  const list = document.getElementById('admin-videos-list');
  list.innerHTML = '';
  if (!res.videos?.length) { list.innerHTML = '<p style="color:var(--text3)">No videos</p>'; return; }
  res.videos.forEach(v => {
    const row = document.createElement('div');
    row.className = 'admin-row';
    row.innerHTML = `
      <div class="admin-row-info">
        <strong>${esc(v.title)}</strong>
        <span>by ${esc(v.username)} · ${formatViews(v.views)} views · ${timeAgo(v.created_at)}</span>
      </div>
      <div class="admin-row-actions">
        <button class="btn btn-ghost" onclick="navigate('watch','${v.id}')">View</button>
        <button class="admin-btn btn" onclick="adminDeleteVideoById('${v.id}', this)">🗑 Delete</button>
      </div>
    `;
    list.appendChild(row);
  });
}

async function loadAdminUsers() {
  const res = await api('/api/admin/users');
  const list = document.getElementById('admin-users-list');
  list.innerHTML = '';
  if (!res.users?.length) { list.innerHTML = '<p style="color:var(--text3)">No users</p>'; return; }
  res.users.forEach(u => {
    const row = document.createElement('div');
    row.className = 'admin-row';
    const isAdm = u.is_admin === 1 || u.username === 'Papi';
    row.innerHTML = `
      <div class="admin-row-info">
        <strong>${esc(u.username)}</strong> ${isAdm ? '<span class="admin-tag">👑 Admin</span>' : ''}
        <span>Joined ${timeAgo(u.created_at)}</span>
      </div>
      <div class="admin-row-actions">
        <button class="btn btn-ghost" onclick="navigate('profile','${u.id}')">Profile</button>
        ${!isAdm ? `<button class="admin-btn btn" onclick="adminDeleteUser('${u.id}', this)">🗑 Delete</button>` : ''}
      </div>
    `;
    list.appendChild(row);
  });
}

function showAdminTab(tab) {
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('admin-videos-tab').classList.add('hidden');
  document.getElementById('admin-users-tab').classList.add('hidden');
  event.target.classList.add('active');
  if (tab === 'videos') { document.getElementById('admin-videos-tab').classList.remove('hidden'); loadAdminVideos(); }
  else { document.getElementById('admin-users-tab').classList.remove('hidden'); loadAdminUsers(); }
}

async function adminDeleteVideoById(videoId, btn) {
  if (!confirm('Delete this video?')) return;
  const res = await api(`/api/videos/${videoId}`, { method: 'DELETE' });
  if (res.success) { btn.closest('.admin-row').remove(); toast('Video deleted'); }
  else toast(res.error || 'Failed');
}

async function adminDeleteUser(userId, btn) {
  if (!confirm('Delete this user and all their content?')) return;
  const res = await api(`/api/admin/users/${userId}`, { method: 'DELETE' });
  if (res.success) { btn.closest('.admin-row').remove(); toast('User deleted'); }
  else toast(res.error || 'Failed');
}

// ===== MODALS =====
function showModal(id) {
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById(id).classList.remove('hidden');
}
function closeAllModals() {
  document.getElementById('modal-overlay').classList.add('hidden');
  document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
  closeDropdowns();
}
function switchModal(from, to) {
  document.getElementById(from).classList.add('hidden');
  document.getElementById(to).classList.remove('hidden');
}
function toggleUserDropdown() { document.getElementById('user-dropdown').classList.toggle('hidden'); }
function closeDropdowns() { document.getElementById('user-dropdown')?.classList.add('hidden'); }
document.addEventListener('click', e => { if (!e.target.closest('.avatar-wrap')) closeDropdowns(); });
document.getElementById('sidebar-toggle').addEventListener('click', () => document.getElementById('sidebar').classList.toggle('open'));

// ===== TOAST =====
let toastTimeout;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => el.classList.add('hidden'), 3000);
}

// ===== API =====
async function api(url, options = {}) {
  try {
    const res = await fetch(url, {
      method: options.method || 'GET',
      headers: options.body ? { 'Content-Type': 'application/json' } : {},
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    return await res.json();
  } catch (e) { return { error: e.message }; }
}

// ===== UTILS =====
function esc(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function timeAgo(ts) {
  const s = Math.floor(Date.now() / 1000) - ts;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s/60) + 'm ago';
  if (s < 86400) return Math.floor(s/3600) + 'h ago';
  if (s < 2592000) return Math.floor(s/86400) + 'd ago';
  if (s < 31536000) return Math.floor(s/2592000) + 'mo ago';
  return Math.floor(s/31536000) + 'y ago';
}
function formatViews(n) {
  if (n >= 1000000) return (n/1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n/1000).toFixed(1) + 'K';
  return n || 0;
}
function hashColor(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  const colors = ['#e53e3e','#dd6b20','#d69e2e','#38a169','#3182ce','#805ad5','#d53f8c','#00b5d8'];
  return colors[Math.abs(hash) % colors.length];
}

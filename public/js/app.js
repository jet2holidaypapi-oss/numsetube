let currentUser = null;
let currentVideo = null;
let currentChatPartnerId = null;
let messageInterval = null;
let selectedVideoFile = null;
let selectedThumbFile = null;

// ── INIT ──
document.addEventListener('DOMContentLoaded', async () => {
  // Wire file input — it lives at top level, always in DOM
  document.getElementById('video-file-input').addEventListener('change', function() {
    const file = this.files[0];
    if (file) goToUploadDetails(file);
  });

  document.getElementById('search-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') searchVideos();
  });
  document.getElementById('comment-input').addEventListener('focus', () => {
    document.getElementById('comment-actions').classList.remove('hidden');
  });

  await checkAuth();
  navigate('home');
  if (currentUser) startMessagePolling();
});

// ── AUTH ──
async function checkAuth() {
  const res = await api('/api/me');
  currentUser = res.user;
  updateAuthUI();
}

function updateAuthUI() {
  const isAdm = currentUser && (currentUser.is_admin === 1 || currentUser.username === 'Papi');
  if (currentUser) {
    document.getElementById('auth-btns').classList.add('hidden');
    document.getElementById('user-menu').classList.remove('hidden');
    document.getElementById('nav-avatar').textContent = currentUser.username[0].toUpperCase();
    document.getElementById('nav-avatar').style.background = hashColor(currentUser.username);
    document.querySelector('.dropdown-user').textContent = currentUser.username;
    document.getElementById('admin-badge-nav').classList.toggle('hidden', !isAdm);
    document.getElementById('admin-panel-link').classList.toggle('hidden', !isAdm);
    document.getElementById('sidebar-admin').classList.toggle('hidden', !isAdm);
  } else {
    document.getElementById('auth-btns').classList.remove('hidden');
    document.getElementById('user-menu').classList.add('hidden');
  }
}

async function submitLogin() {
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  errEl.classList.add('hidden');
  if (!username || !password) { errEl.textContent = 'Fill in all fields'; errEl.classList.remove('hidden'); return; }
  const res = await api('/api/login', { method: 'POST', body: { username, password } });
  if (res.error) { errEl.textContent = res.error; errEl.classList.remove('hidden'); return; }
  currentUser = res.user;
  updateAuthUI(); closeAllModals();
  toast('Welcome back, ' + currentUser.username + '!');
  startMessagePolling();
}

async function submitRegister() {
  const username = document.getElementById('reg-username').value.trim();
  const password = document.getElementById('reg-password').value;
  const errEl = document.getElementById('reg-error');
  errEl.classList.add('hidden');
  if (!username || !password) { errEl.textContent = 'Fill in all fields'; errEl.classList.remove('hidden'); return; }
  const res = await api('/api/register', { method: 'POST', body: { username, password } });
  if (res.error) { errEl.textContent = res.error; errEl.classList.remove('hidden'); return; }
  currentUser = res.user;
  updateAuthUI(); closeAllModals();
  toast('Welcome, ' + currentUser.username + '!');
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

// ── NAVIGATION ──
function navigate(page, data) {
  document.querySelectorAll('.page').forEach(p => { p.style.display = 'none'; p.classList.remove('active'); });
  document.querySelectorAll('.sidebar-item').forEach(s => s.classList.remove('active'));
  closeDropdowns();

  const pageEl = document.getElementById('page-' + page);
  if (!pageEl) return;
  pageEl.style.display = 'block';
  pageEl.classList.add('active');

  const sb = document.querySelector(`.sidebar-item[onclick*="'${page}'"]`);
  if (sb) sb.classList.add('active');

  switch (page) {
    case 'home':            loadHomeVideos(); break;
    case 'watch':           loadWatchPage(data); break;
    case 'messages':
      if (!currentUser) { showModal('login-modal'); return; }
      loadConversations();
      if (data) openConversation(data);
      break;
    case 'profile':         loadProfile(data); break;
    case 'profile-self':
      if (!currentUser) { showModal('login-modal'); return; }
      loadProfile(currentUser.id); break;
    case 'search':          loadSearchPage(data); break;
    case 'admin':
      if (!currentUser || (currentUser.is_admin !== 1 && currentUser.username !== 'Papi')) { toast('Admin only'); navigate('home'); return; }
      loadAdminPanel(); break;
  }
}

// ── UPLOAD — the only right way ──
// startUpload() is called by every upload button/link
function startUpload() {
  if (!currentUser) { showModal('login-modal'); return; }
  // Show the overlay
  document.getElementById('upload-overlay').classList.remove('hidden');
}

function closeUploadOverlay() {
  document.getElementById('upload-overlay').classList.add('hidden');
  // Reset file input so same file can be picked again
  document.getElementById('video-file-input').value = '';
}

function uploadDragOver(e) {
  e.preventDefault();
  e.stopPropagation();
  document.getElementById('upload-overlay-body') || e.currentTarget.classList.add('drag-over');
  e.currentTarget.classList.add('drag-over');
}
function uploadDragLeave(e) {
  e.currentTarget.classList.remove('drag-over');
}
function uploadDrop(e) {
  e.preventDefault();
  e.stopPropagation();
  e.currentTarget.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (!file) return;
  if (!file.type.startsWith('video/')) { toast('Please drop a video file'); return; }
  closeUploadOverlay();
  goToUploadDetails(file);
}

function goToUploadDetails(file) {
  selectedVideoFile = file;
  closeUploadOverlay();

  // Show the details page
  document.querySelectorAll('.page').forEach(p => { p.style.display = 'none'; p.classList.remove('active'); p.classList.add('hidden'); });
  const det = document.getElementById('page-upload-details');
  det.style.display = 'block';
  det.classList.add('active');

  document.getElementById('upload-filename-display').textContent = file.name;
  document.getElementById('upload-title').value = file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
  document.getElementById('upload-description').value = '';
  document.getElementById('thumb-preview-wrap').classList.add('hidden');
  document.getElementById('thumb-upload-option').classList.remove('hidden');
  document.getElementById('upload-progress-wrap').classList.add('hidden');
  document.getElementById('upload-progress').style.width = '0%';
  document.getElementById('upload-video-preview').src = URL.createObjectURL(file);
}

function cancelUploadDetails() {
  selectedVideoFile = null;
  selectedThumbFile = null;
  document.getElementById('video-file-input').value = '';
  navigate('home');
}

function previewThumb(e) {
  selectedThumbFile = e.target.files[0];
  if (selectedThumbFile) {
    document.getElementById('thumb-preview').src = URL.createObjectURL(selectedThumbFile);
    document.getElementById('thumb-preview-wrap').classList.remove('hidden');
    document.getElementById('thumb-upload-option').classList.add('hidden');
  }
}

function removeThumb() {
  selectedThumbFile = null;
  document.getElementById('thumb-file-input').value = '';
  document.getElementById('thumb-preview-wrap').classList.add('hidden');
  document.getElementById('thumb-upload-option').classList.remove('hidden');
}

async function submitUpload() {
  if (!selectedVideoFile) { toast('No video selected'); return; }
  const title = document.getElementById('upload-title').value.trim();
  if (!title) { toast('Please enter a title'); return; }

  const formData = new FormData();
  formData.append('video', selectedVideoFile);
  formData.append('title', title);
  formData.append('description', document.getElementById('upload-description').value);
  if (selectedThumbFile) formData.append('thumbnail', selectedThumbFile);

  const progressWrap = document.getElementById('upload-progress-wrap');
  const progressBar  = document.getElementById('upload-progress');
  const progressText = document.getElementById('upload-progress-text');
  const publishBtn   = document.getElementById('publish-btn');

  progressWrap.classList.remove('hidden');
  publishBtn.disabled = true;
  publishBtn.textContent = 'Uploading...';

  try {
    const res = await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.upload.onprogress = e => {
        if (e.lengthComputable) {
          const pct = Math.round(e.loaded / e.total * 100);
          progressBar.style.width = pct + '%';
          progressText.textContent = pct + '%';
        }
      };
      xhr.onload  = () => resolve(JSON.parse(xhr.responseText));
      xhr.onerror = () => reject(new Error('Network error'));
      xhr.open('POST', '/api/videos/upload-with-thumb');
      xhr.send(formData);
    });

    if (res.videoId) {
      toast('Video published!');
      selectedVideoFile = null;
      selectedThumbFile = null;
      document.getElementById('video-file-input').value = '';
      navigate('watch', res.videoId);
    } else {
      toast(res.error || 'Upload failed');
    }
  } catch (err) {
    toast('Upload failed: ' + err.message);
  } finally {
    progressWrap.classList.add('hidden');
    publishBtn.disabled = false;
    publishBtn.textContent = 'Publish';
    progressBar.style.width = '0%';
  }
}

// ── HOME ──
async function loadHomeVideos() {
  const res = await api('/api/videos?limit=30');
  const grid = document.getElementById('home-grid');
  const empty = document.getElementById('home-empty');
  grid.innerHTML = '';
  if (!res.videos?.length) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  res.videos.forEach(v => grid.appendChild(createVideoCard(v)));
}

function createVideoCard(v) {
  const card = document.createElement('div');
  card.className = 'video-card';
  card.onclick = () => navigate('watch', v.id);
  const thumbSrc = v.thumbnail ? `/thumbnails/${v.thumbnail}` : null;
  const adminBadge = (v.is_admin === 1 || v.username === 'Papi') ? ' <span class="admin-tag" style="font-size:.68rem">👑</span>' : '';
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
    </div>`;
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
      <div class="related-channel">${esc(v.username)} · ${formatViews(v.views)} views</div>
    </div>`;
  return card;
}

// ── WATCH ──
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
  document.getElementById('watch-channel-admin-tag').classList.toggle('hidden', !(video.is_admin === 1 || video.username === 'Papi'));

  updateLikeButtons(likes, userLike);

  const subBtn = document.getElementById('subscribe-btn');
  if (!currentUser || currentUser.id === video.user_id) subBtn.classList.add('hidden');
  else {
    subBtn.classList.remove('hidden');
    subBtn.textContent = isSubbed ? 'Subscribed ✓' : 'Subscribe';
    subBtn.classList.toggle('subscribed', isSubbed);
  }
  document.getElementById('message-creator-btn').classList.toggle('hidden', !currentUser || currentUser.id === video.user_id);
  document.getElementById('admin-delete-video-btn').classList.toggle('hidden', !(viewerIsAdmin && currentUser?.id !== video.user_id));

  const ca = document.getElementById('comment-user-avatar');
  if (currentUser) {
    ca.textContent = currentUser.username[0].toUpperCase();
    ca.style.background = hashColor(currentUser.username);
    document.getElementById('comment-form-wrap').classList.remove('hidden');
  } else {
    document.getElementById('comment-form-wrap').classList.add('hidden');
  }
  loadComments(videoId);
  loadRelatedVideos(videoId);
}

function updateLikeButtons(likes, userLike) {
  document.getElementById('like-count').textContent = likes.find(l => l.type === 'like')?.count || 0;
  document.getElementById('dislike-count').textContent = likes.find(l => l.type === 'dislike')?.count || 0;
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
  if (!confirm('Delete this video?')) return;
  const res = await api(`/api/videos/${currentVideo.id}`, { method: 'DELETE' });
  if (res.success) { toast('Deleted'); navigate('home'); } else toast(res.error || 'Failed');
}
function viewChannel() { if (currentVideo) navigate('profile', currentVideo.user_id); }
function messageCreator() { if (!currentUser) { showModal('login-modal'); return; } navigate('messages', currentVideo.user_id); }

async function loadRelatedVideos(videoId) {
  const res = await api('/api/videos?limit=12');
  const c = document.getElementById('related-videos');
  c.innerHTML = '';
  res.videos?.filter(v => v.id !== videoId).forEach(v => c.appendChild(createRelatedCard(v)));
}

// ── COMMENTS ──
async function loadComments(videoId) {
  const res = await api(`/api/videos/${videoId}/comments`);
  document.getElementById('comments-count').textContent = `${res.comments?.length || 0} Comments`;
  const list = document.getElementById('comments-list');
  list.innerHTML = '';
  res.comments?.forEach(c => list.appendChild(createCommentEl(c)));
}
function createCommentEl(c) {
  const el = document.createElement('div');
  el.className = 'comment-item'; el.id = 'comment-' + c.id;
  const isAdm = c.is_admin === 1 || c.username === 'Papi';
  const canDel = currentUser?.id === c.user_id || (currentUser && (currentUser.is_admin === 1 || currentUser.username === 'Papi'));
  el.innerHTML = `
    <div class="avatar" style="background:${hashColor(c.username)}">${c.username[0].toUpperCase()}</div>
    <div class="comment-content">
      <div class="comment-meta">
        <span class="comment-author">${esc(c.username)}</span>
        ${isAdm ? '<span class="admin-tag" style="font-size:.68rem">👑</span>' : ''}
        <span class="comment-time">${timeAgo(c.created_at)}</span>
        ${canDel ? `<button class="comment-delete" onclick="deleteComment('${c.id}')">✕ Delete</button>` : ''}
      </div>
      <div class="comment-text">${esc(c.text)}</div>
    </div>`;
  return el;
}
function cancelComment() { document.getElementById('comment-input').value = ''; document.getElementById('comment-actions').classList.add('hidden'); }
async function submitComment() {
  const input = document.getElementById('comment-input');
  const text = input.value.trim();
  if (!text || !currentUser) { if (!currentUser) showModal('login-modal'); return; }
  const res = await api(`/api/videos/${currentVideo.id}/comments`, { method: 'POST', body: { text } });
  if (res.comment) {
    document.getElementById('comments-list').prepend(createCommentEl(res.comment));
    input.value = ''; cancelComment();
    const c = document.getElementById('comments-count');
    c.textContent = (parseInt(c.textContent) + 1) + ' Comments';
  }
}
async function deleteComment(id) {
  await api(`/api/comments/${id}`, { method: 'DELETE' });
  document.getElementById('comment-' + id)?.remove();
  toast('Comment deleted');
}

// ── MESSAGES ──
async function loadConversations() {
  const res = await api('/api/messages/conversations');
  const list = document.getElementById('conversations-list');
  list.innerHTML = '';
  if (!res.conversations?.length) { document.getElementById('conversations-empty').classList.remove('hidden'); return; }
  document.getElementById('conversations-empty').classList.add('hidden');
  res.conversations.forEach(c => list.appendChild(createConvoEl(c)));
  updateUnreadBadge();
}
function createConvoEl(c) {
  const el = document.createElement('div');
  el.className = 'conversation-item' + (currentChatPartnerId === c.other_id ? ' active' : '');
  el.id = 'convo-' + c.other_id;
  el.onclick = () => openConversation(c.other_id);
  el.innerHTML = `
    <div class="avatar" style="background:${hashColor(c.other_username)}">${c.other_username[0].toUpperCase()}</div>
    <div class="convo-info">
      <div class="convo-name">${esc(c.other_username)}${c.unread > 0 ? ` <span class="badge">${c.unread}</span>` : ''}</div>
      <div class="convo-last">${esc(c.last_message || '')}</div>
    </div>`;
  return el;
}
async function openConversation(userId) {
  currentChatPartnerId = userId;
  document.querySelectorAll('.conversation-item').forEach(i => i.classList.remove('active'));
  document.getElementById('convo-' + userId)?.classList.add('active');
  const res = await api(`/api/messages/${userId}`);
  document.getElementById('chat-placeholder').classList.add('hidden');
  document.getElementById('chat-active').classList.remove('hidden');
  const partnerName = document.getElementById('convo-' + userId)?.querySelector('.convo-name')?.childNodes[0]?.textContent?.trim() || 'User';
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
  el.className = 'msg-bubble-wrap' + (m.sender_id === currentUser.id ? ' mine' : '');
  el.innerHTML = `<div class="msg-bubble">${esc(m.text)}</div>`;
  return el;
}
async function sendMessage() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text || !currentChatPartnerId) return;
  input.value = '';
  await api(`/api/messages/${currentChatPartnerId}`, { method: 'POST', body: { text } });
  const res = await api(`/api/messages/${currentChatPartnerId}`);
  const chatMsgs = document.getElementById('chat-messages');
  chatMsgs.innerHTML = '';
  res.messages?.forEach(m => chatMsgs.appendChild(createMessageEl(m)));
  chatMsgs.scrollTop = chatMsgs.scrollHeight;
  loadConversations();
}
async function updateUnreadBadge() {
  const res = await api('/api/messages/conversations');
  const total = res.conversations?.reduce((s, c) => s + (c.unread || 0), 0) || 0;
  const badge = document.getElementById('unread-badge');
  badge.textContent = total; badge.classList.toggle('hidden', total === 0);
}
function startMessagePolling() { messageInterval = setInterval(updateUnreadBadge, 30000); }
function stopMessagePolling() { if (messageInterval) { clearInterval(messageInterval); messageInterval = null; } }

// ── PROFILE ──
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
  document.getElementById('profile-admin-tag').classList.toggle('hidden', !(user.is_admin === 1 || user.username === 'Papi'));
  const isSelf = currentUser?.id === user.id;
  document.getElementById('profile-subscribe-btn').classList.toggle('hidden', !currentUser || isSelf);
  document.getElementById('profile-message-btn').classList.toggle('hidden', !currentUser || isSelf);
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
function messageProfileUser() { if (currentUser && profileData) navigate('messages', profileData.user.id); }

// ── SEARCH ──
function searchVideos() {
  const q = document.getElementById('search-input').value.trim();
  if (q) navigate('search', q);
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

// ── ADMIN ──
async function loadAdminPanel() { loadAdminVideos(); }
async function loadAdminVideos() {
  const res = await api('/api/videos?limit=100');
  const list = document.getElementById('admin-videos-list');
  list.innerHTML = '';
  if (!res.videos?.length) { list.innerHTML = '<p style="color:var(--text3)">No videos</p>'; return; }
  res.videos.forEach(v => {
    const row = document.createElement('div'); row.className = 'admin-row';
    row.innerHTML = `
      <div class="admin-row-info"><strong>${esc(v.title)}</strong><span>by ${esc(v.username)} · ${formatViews(v.views)} views · ${timeAgo(v.created_at)}</span></div>
      <div class="admin-row-actions">
        <button class="btn btn-ghost" onclick="navigate('watch','${v.id}')">View</button>
        <button class="admin-btn btn" onclick="adminDeleteVideoById('${v.id}',this)">🗑 Delete</button>
      </div>`;
    list.appendChild(row);
  });
}
async function loadAdminUsers() {
  const res = await api('/api/admin/users');
  const list = document.getElementById('admin-users-list');
  list.innerHTML = '';
  if (!res.users?.length) { list.innerHTML = '<p style="color:var(--text3)">No users</p>'; return; }
  res.users.forEach(u => {
    const isAdm = u.is_admin === 1 || u.username === 'Papi';
    const row = document.createElement('div'); row.className = 'admin-row';
    row.innerHTML = `
      <div class="admin-row-info"><strong>${esc(u.username)}${isAdm ? ' <span class="admin-tag">👑</span>' : ''}</strong><span>Joined ${timeAgo(u.created_at)}</span></div>
      <div class="admin-row-actions">
        <button class="btn btn-ghost" onclick="navigate('profile','${u.id}')">Profile</button>
        ${!isAdm ? `<button class="admin-btn btn" onclick="adminDeleteUser('${u.id}',this)">🗑 Delete</button>` : ''}
      </div>`;
    list.appendChild(row);
  });
}
function showAdminTab(tab, e) {
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
  e.target.classList.add('active');
  document.getElementById('admin-videos-tab').classList.add('hidden');
  document.getElementById('admin-users-tab').classList.add('hidden');
  if (tab === 'videos') { document.getElementById('admin-videos-tab').classList.remove('hidden'); loadAdminVideos(); }
  else { document.getElementById('admin-users-tab').classList.remove('hidden'); loadAdminUsers(); }
}
async function adminDeleteVideoById(id, btn) {
  if (!confirm('Delete video?')) return;
  const res = await api(`/api/videos/${id}`, { method: 'DELETE' });
  if (res.success) { btn.closest('.admin-row').remove(); toast('Deleted'); } else toast(res.error);
}
async function adminDeleteUser(id, btn) {
  if (!confirm('Delete user?')) return;
  const res = await api(`/api/admin/users/${id}`, { method: 'DELETE' });
  if (res.success) { btn.closest('.admin-row').remove(); toast('Deleted'); } else toast(res.error);
}

// ── MODALS ──
function showModal(id) { document.getElementById('modal-overlay').classList.remove('hidden'); document.getElementById(id).classList.remove('hidden'); }
function closeAllModals() { document.getElementById('modal-overlay').classList.add('hidden'); document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden')); closeDropdowns(); }
function switchModal(from, to) { document.getElementById(from).classList.add('hidden'); document.getElementById(to).classList.remove('hidden'); }
function toggleUserDropdown() { document.getElementById('user-dropdown').classList.toggle('hidden'); }
function closeDropdowns() { document.getElementById('user-dropdown')?.classList.add('hidden'); }
document.addEventListener('click', e => { if (!e.target.closest('.avatar-wrap')) closeDropdowns(); });
document.getElementById('sidebar-toggle').addEventListener('click', () => document.getElementById('sidebar').classList.toggle('open'));

// ── TOAST ──
let toastTimeout;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.remove('hidden');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => el.classList.add('hidden'), 3000);
}

// ── API ──
async function api(url, opts = {}) {
  try {
    const res = await fetch(url, { method: opts.method || 'GET', headers: opts.body ? { 'Content-Type': 'application/json' } : {}, body: opts.body ? JSON.stringify(opts.body) : undefined });
    return await res.json();
  } catch (e) { return { error: e.message }; }
}

// ── UTILS ──
function esc(s) { return s ? s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : ''; }
function timeAgo(ts) {
  const s = Math.floor(Date.now()/1000) - ts;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s/60)+'m ago';
  if (s < 86400) return Math.floor(s/3600)+'h ago';
  if (s < 2592000) return Math.floor(s/86400)+'d ago';
  if (s < 31536000) return Math.floor(s/2592000)+'mo ago';
  return Math.floor(s/31536000)+'y ago';
}
function formatViews(n) { if (n>=1e6) return (n/1e6).toFixed(1)+'M'; if (n>=1000) return (n/1000).toFixed(1)+'K'; return n||0; }
function hashColor(s) {
  let h=0; for(let i=0;i<s.length;i++) h=s.charCodeAt(i)+((h<<5)-h);
  return ['#e53e3e','#dd6b20','#d69e2e','#38a169','#3182ce','#805ad5','#d53f8c','#00b5d8'][Math.abs(h)%8];
}

let currentVocabList = [];
let originalVocabList = [];
let activeIndex = -1;
let currentView = 'vocab';

let fcList = [];
let fcIndex = 0;
let isFlipped = false;

let fcMode = 'flashcard';
let quizAnswered = false;
let quizSelectedOption = '';

let activeWriterQuiz = null;
let currentQuizCharIndex = 0;
let writeSubMode = 'guided';

let hskCharDb = null;
let hskRadicalDb = null;

let appSettings = {
  voiceURI: '',
  speechSpeed: 0.6,
  strokeSpeed: 1.4,
  lang: 'vi'
};

let syncQueueActive = false;
let syncCancelRequested = false;

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  const val = typeof str === 'string' ? str : String(str);
  return val
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function speakZh(text, e) {
  if (e) e.stopPropagation();
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN';
    u.rate = appSettings.speechSpeed;
    u.volume = 1;

    const voices = window.speechSynthesis.getVoices();
    let selectedVoice = voices.find(v => v.voiceURI === appSettings.voiceURI);

    if (!selectedVoice) {
      // Look for Kangkang voice first
      const kangkang = voices.find(v => v.name.toLowerCase().includes('kangkang') && (v.lang.includes('zh') || v.lang.includes('ZH')));
      if (kangkang) {
        selectedVoice = kangkang;
      } else {
        const zhVoice = voices.find(v => v.lang.includes('zh') || v.lang.includes('ZH'));
        if (zhVoice) selectedVoice = zhVoice;
      }
    }

    if (selectedVoice) u.voice = selectedVoice;
    window.speechSynthesis.speak(u);
  }
}

async function fetchLessonData(num) {
  try {
    const r = await fetch(`lessons/lesson_${num}.json`);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

async function discoverLessons() {
  const select = document.getElementById('lessonSelect');
  while (select.options.length > 2) select.remove(2);

  // Load custom lessons list from localStorage
  const customLessons = JSON.parse(localStorage.getItem('custom_lessons') || '[]');

  let n = 1;
  while (true) {
    const data = await fetchLessonData(n);
    if (data) {
      const opt = document.createElement('option');
      opt.value = n;
      opt.textContent = `Bài ${n}: ${data.title} (${data.translation})`;
      select.appendChild(opt);
      n++;
    } else {
      const custom = customLessons.find(cl => cl.lesson === n);
      if (custom) {
        const opt = document.createElement('option');
        opt.value = n;
        opt.textContent = `Bài ${n}: ${custom.title} (${custom.translation})`;
        select.appendChild(opt);
        n++;
      } else {
        break;
      }
    }
  }
  select.value = 'all';
  await loadAndRenderData();
}

async function loadAndRenderData() {
  const selected = document.getElementById('lessonSelect').value;
  let newList = [];

  // Helper to load complete vocab list of a lesson (either from custom localStorage or static JSON file)
  async function loadLessonVocab(num) {
    const cachedVocab = localStorage.getItem(`custom_vocab_lesson_${num}`);
    if (cachedVocab) {
      try {
        return {
          lesson: num,
          vocab: JSON.parse(cachedVocab)
        };
      } catch (e) {}
    }

    const fileData = await fetchLessonData(num);
    if (fileData) {
      return fileData;
    }

    const customLessons = JSON.parse(localStorage.getItem('custom_lessons') || '[]');
    const custom = customLessons.find(cl => cl.lesson === num);
    if (custom) {
      return {
        lesson: num,
        vocab: []
      };
    }

    return null;
  }

  if (selected === 'all' || selected === 'starred') {
    const promises = [];
    const options = Array.from(document.getElementById('lessonSelect').options).slice(2);
    for (const opt of options) {
      const num = parseInt(opt.value);
      if (!isNaN(num)) promises.push(loadLessonVocab(num));
    }
    const results = await Promise.all(promises);
    newList = results
      .filter(d => d !== null)
      .flatMap(d => {
        if (d && Array.isArray(d.vocab)) {
          return d.vocab.map(item => {
            item.lesson = d.lesson;
            if (!item.pinyin && window.pinyinPro) {
              item.pinyin = window.pinyinPro.pinyin(item.hanzi);
            }
            const cached = localStorage.getItem(`vocab_cache_${item.hanzi}`);
            if (cached) {
              try {
                const parsed = JSON.parse(cached);
                if (parsed.meaning && parsed.meaning !== 'Đang dịch...' && parsed.meaning !== 'Từ vựng') {
                  item.meaning = parsed.meaning;
                  item.examples = parsed.examples || [];
                  item.type = item.type || parsed.type;
                }
              } catch (e) {}
            }
            return item;
          });
        }
        return [];
      });

    if (selected === 'starred') {
      const starred = JSON.parse(localStorage.getItem('starred_words') || '[]');
      newList = newList.filter(item => starred.includes(item.hanzi));
    }
  } else {
    const data = await loadLessonVocab(parseInt(selected));
    if (data && Array.isArray(data.vocab)) {
      newList = data.vocab.map(item => {
        item.lesson = data.lesson;
        if (!item.pinyin && window.pinyinPro) {
          item.pinyin = window.pinyinPro.pinyin(item.hanzi);
        }
        // Warm up cache immediately on load
        const cached = localStorage.getItem(`vocab_cache_${item.hanzi}`);
        if (cached) {
          try {
            const parsed = JSON.parse(cached);
            if (parsed.meaning && parsed.meaning !== 'Đang dịch...' && parsed.meaning !== 'Từ vựng') {
              item.meaning = parsed.meaning;
              item.examples = parsed.examples || [];
              item.type = item.type || parsed.type;
            }
          } catch (e) {}
        }
        return item;
      });
    } else {
      newList = [];
    }
  }

  currentVocabList = newList;
  originalVocabList = [...newList];

  document.getElementById('searchInput').value = '';
  activeIndex = -1;

  renderTopBar();
  initFlashcards();

  if (currentView === 'dialogue') {
    loadAndRenderDialogues();
  }

  if (currentVocabList.length > 0) {
    selectWord(0);
    proposePreFetch();
  } else {
    document.getElementById('detailCard').innerHTML =
      '<div style="color: var(--text-muted); font-weight: 500;">Không có dữ liệu bài học này</div>';
  }
}

function switchView(view) {
  currentView = view;
  document.querySelectorAll('.sidebar-tab').forEach(b => b.classList.remove('active'));
  const activeTab = document.getElementById(`tab-${view}`);
  if (activeTab) activeTab.classList.add('active');

  const sidebar = document.querySelector('.app-sidebar');
  if (sidebar && sidebar.classList.contains('mobile-open')) {
    sidebar.classList.remove('mobile-open');
  }

  const headerBottomContent = document.getElementById('headerBottomContent');
  const fcModesContainer = document.getElementById('fcModesContainer');

  document.getElementById('view-vocab').style.display = 'none';
  document.getElementById('view-flashcard').style.display = 'none';
  const viewDialogue = document.getElementById('view-dialogue');
  if (viewDialogue) viewDialogue.style.display = 'none';

  // Always keep search and lesson selector visible!
  if (headerBottomContent) headerBottomContent.style.display = 'flex';

  if (view === 'vocab') {
    document.getElementById('view-vocab').style.display = 'flex';
    if (fcModesContainer) fcModesContainer.style.display = 'none';
  } else if (view === 'flashcard') {
    document.getElementById('view-flashcard').style.display = 'flex';
    if (fcModesContainer) fcModesContainer.style.display = 'flex';
    renderFlashcard();
  } else if (view === 'dialogue') {
    if (viewDialogue) viewDialogue.style.display = 'flex';
    if (fcModesContainer) fcModesContainer.style.display = 'none';
    loadAndRenderDialogues();
  }
}

function renderTopBar() {
  const topBar = document.getElementById('topVocabBar');
  topBar.innerHTML = currentVocabList.map((item, i) => `
    <div class="vocab-chip ${i === activeIndex ? 'active' : ''}" id="chip-${i}" onclick="selectWord(${i})">
      <span class="hanzi">${item.hanzi}</span>
      <span class="pinyin">${item.pinyin}</span>
    </div>
  `).join('');
}

async function getOnlineVocabData(hanzi) {
  const cacheKey = `vocab_cache_${hanzi}`;
  const cached = localStorage.getItem(cacheKey);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      // Make sure we do not return a broken/stuck 'Đang dịch...' state from cached data
      if (parsed.meaning && parsed.meaning !== 'Đang dịch...' && parsed.meaning !== 'Từ vựng') {
        return parsed;
      }
    } catch (e) {}
  }

  let pinyin = '';
  if (window.pinyinPro) {
    pinyin = window.pinyinPro.pinyin(hanzi);
  }

  let meaning = 'Đang dịch...';
  let examples = [];
  let type = 'Từ vựng';

  try {
    const transUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(hanzi)}&langpair=zh-CN|vi`;
    const tatoebaUrl = `https://api.tatoeba.org/v1/sentences?lang=cmn&q=${encodeURIComponent(hanzi)}&sort=relevance`;

    const transPromise = fetch(transUrl).then(r => r.json());
    const tatoebaPromise = fetch(tatoebaUrl).then(r => r.json());

    // Execute concurrently!
    const [transRes, tatoebaRes] = await Promise.allSettled([transPromise, tatoebaPromise]);

    if (transRes.status === 'fulfilled' && transRes.value?.responseData?.translatedText) {
      meaning = transRes.value.responseData.translatedText.trim();
    }

    if (tatoebaRes.status === 'fulfilled' && Array.isArray(tatoebaRes.value?.data) && tatoebaRes.value.data.length > 0) {
      // Prioritize conversational questions (Smart Context)
      const sortedData = tatoebaRes.value.data.sort((a, b) => {
        const questionWords = /([?？吗呢什么怎么为什么])/;
        const aHasQ = questionWords.test(a.text) ? 1 : 0;
        const bHasQ = questionWords.test(b.text) ? 1 : 0;
        return bHasQ - aHasQ; // Sort questions to the top
      });

      const rawExamples = sortedData.slice(0, 2);
      
      const examplePromises = rawExamples.map(async (ex) => {
        const zhText = ex.text;
        let exPinyin = window.pinyinPro ? window.pinyinPro.pinyin(zhText) : '';
        let exVi = '';

        try {
          const exTransUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(zhText)}&langpair=zh-CN|vi`;
          const exTransRes = await fetch(exTransUrl).then(r => r.json());
          if (exTransRes?.responseData?.translatedText) {
            exVi = exTransRes.responseData.translatedText.trim();
          }
        } catch (err) {
          console.error('Error translating example:', err);
        }

        return {
          zh: zhText,
          pinyin: exPinyin,
          vi: exVi || zhText
        };
      });

      // These inner fetch calls are also concurrent with each other
      examples = await Promise.all(examplePromises);
    }

    const result = { pinyin, meaning, examples, type };

    // ONLY write to cache if we reached this point successfully without any errors!
    if (meaning && meaning !== 'Đang dịch...' && meaning !== 'Từ vựng') {
      localStorage.setItem(cacheKey, JSON.stringify(result));
    }
    return result;
  } catch (error) {
    console.error('Error fetching online vocab:', error);
    // Return whatever we managed to fetch, but DO NOT save it to localStorage
    return { pinyin, meaning, examples, type };
  }
}

function toggleStar(hanzi, e) {
  if (e) e.stopPropagation();
  let starred = JSON.parse(localStorage.getItem('starred_words') || '[]');
  if (starred.includes(hanzi)) {
    starred = starred.filter(w => w !== hanzi);
  } else {
    starred.push(hanzi);
  }
  localStorage.setItem('starred_words', JSON.stringify(starred));
  
  // Re-render current card to update star icon
  if (activeIndex !== -1) {
    selectWord(activeIndex);
  } else if (currentVocabList.length === 1 && currentVocabList[0].type === 'Tra cứu trực tuyến') {
    // If it's a searched word not in standard list
    renderWordToCard(currentVocabList[0], 'detailCard', 'strokeContainer', true);
  }
}

function renderWordToCard(item, cardContainerId, strokeContainerId, isDictionary = false) {
  const card = document.getElementById(cardContainerId);
  if (!card) return;

  const hasData = item.meaning && item.meaning !== 'Đang dịch...' && item.meaning !== 'Từ vựng';
  const starred = JSON.parse(localStorage.getItem('starred_words') || '[]');
  const isStarred = starred.includes(item.hanzi);

  let meaningHtml = '';
  if (hasData) {
    meaningHtml = item.meaning;
  } else {
    if (isDictionary) {
      meaningHtml = `<span style="font-size: 14px; font-weight: normal; color: var(--text-muted);">Đang tải nghĩa...</span>`;
    } else {
      meaningHtml = `<span class="lazy-load-trigger" style="font-size: 14px; font-weight: normal; color: var(--accent); cursor: pointer;" onclick="lazyLoadWord(${activeIndex}, event)">🔍 Bấm để tải nghĩa & ví dụ...</span>`;
    }
  }

  const examplesHtml = hasData && item.examples && item.examples.length > 0
    ? item.examples.map(ex => `
        <div class="example-item">
          <button class="audio-btn" data-zh="${escapeHtml(ex.zh)}" onclick="speakZh(this.getAttribute('data-zh'), event)">🔊</button>
          <div class="ex-content">
            <div class="ex-zh">${ex.zh}</div>
            <div class="ex-py">${ex.pinyin}</div>
            <div class="ex-vi">${ex.vi}</div>
          </div>
        </div>
      `).join('')
    : (hasData ? '<div style="color: var(--text-muted);">Chưa có ví dụ</div>' : '<div style="color: var(--text-muted); font-size: 12px;">Đang trống</div>');

  // Get Hán-Việt, Mnemonic and Radicals
  let hanVietArr = [];
  let mnemonicsHtml = '';
  let radicalsHtml = '';

  const chars = item.hanzi.split('');
  
  if (hskCharDb && hskRadicalDb) {
    chars.forEach(char => {
      const charData = hskCharDb.find(c => c.hanzi === char);
      if (charData) {
        if (charData.sinoViet) {
          hanVietArr.push(charData.sinoViet.toUpperCase());
        }
        
        // Mnemonics
        if (charData.mnemonic) {
          const lang = appSettings.lang || 'vi';
          mnemonicsHtml += `
            <div style="font-size: 13px; margin-bottom: 8px; line-height: 1.4; text-align: left; background: var(--accent-soft); padding: 10px 14px; border-radius: 12px; border-left: 3px solid var(--accent); color: var(--text-primary);">
              <strong>${char}:</strong> ${charData.mnemonic}
            </div>
          `;
        }
        
        // Radicals/Components
        if (Array.isArray(charData.radicals) && charData.radicals.length > 0) {
          const radsDetail = charData.radicals.map(radChar => {
            const radInfo = hskRadicalDb.find(r => r.char === radChar);
            if (radInfo) {
              const radName = radInfo.nameVi || '';
              const radMeaning = radInfo.meaning || '';
              return `
                <div class="radical-chip" style="display: flex; align-items: center; gap: 8px; background: var(--bg-body); border: 1px solid var(--border-card); padding: 6px 12px; border-radius: 10px; font-size: 12px; flex-shrink:0;">
                  <span style="font-size: 16px; font-weight: bold; color: var(--accent);">${radChar}</span>
                  <div style="display: flex; flex-direction: column; text-align: left; line-height: 1.2;">
                    <span style="font-weight: 700; color: var(--text-primary); font-size: 11px;">${radName}</span>
                    <span style="color: var(--text-secondary); font-size: 10px;">${radMeaning}</span>
                  </div>
                </div>
              `;
            } else {
              return `
                <div class="radical-chip" style="display: flex; align-items: center; gap: 8px; background: var(--bg-body); border: 1px solid var(--border-card); padding: 6px 12px; border-radius: 10px; font-size: 12px; flex-shrink:0;">
                  <span style="font-size: 16px; font-weight: bold; color: var(--accent);">${radChar}</span>
                </div>
              `;
            }
          }).join('');
          
          const lang = appSettings.lang || 'vi';
          const compLabel = lang === 'vi' ? `Thành phần chữ [${char}]` : `Components of [${char}]`;
          radicalsHtml += `
            <div style="margin-top: 10px; text-align: left; width: 100%;">
              <div style="font-weight: 700; font-size: 11px; color: var(--text-secondary); margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px;">${compLabel}</div>
              <div style="display: flex; flex-wrap: wrap; gap: 8px;">${radsDetail}</div>
            </div>
          `;
        }
      }
    });
  }

  const lang = appSettings.lang || 'vi';

  let adminActions = '';
  if (!isDictionary) {
    adminActions = `
      <div class="swipe-hint">👈 Vuốt / Kéo chuột hoặc dùng phím ◄ ► để chuyển từ 👉</div>
      <div class="word-card-actions">
        <button class="action-btn-small" data-hanzi="${escapeHtml(item.hanzi)}" onclick="toggleStar(this.getAttribute('data-hanzi'), event)">${isStarred ? '⭐ Đã lưu' : '☆ Lưu từ'}</button>
        <button class="action-btn-small" onclick="openEditWordModal()">✏️ Sửa từ</button>
        <button class="action-btn-small delete" onclick="deleteCurrentWord()">🗑️ Xóa từ</button>
      </div>
    `;
  } else {
    adminActions = `
      <div class="word-card-actions" style="margin-top:0;">
        <button class="action-btn-small" data-hanzi="${escapeHtml(item.hanzi)}" onclick="toggleStar(this.getAttribute('data-hanzi'), event)">${isStarred ? '⭐ Đã lưu' : '☆ Lưu từ'}</button>
      </div>
    `;
  }

  card.innerHTML = `
    ${adminActions}
    <div class="stroke-container" id="${strokeContainerId}"></div>
    <div class="word-header">
      <span class="pinyin-large">${item.pinyin || ''}</span>
      <button class="audio-btn-lg" data-zh="${escapeHtml(item.hanzi)}" onclick="speakZh(this.getAttribute('data-zh'))">🔊</button>
    </div>
    ${hanVietArr.length > 0 ? `<div style="font-size: 13px; font-weight: 700; color: var(--text-secondary); text-transform: uppercase; margin-bottom: 6px; letter-spacing: 0.5px; text-align:center;">Hán Việt: ${hanVietArr.join(' ')}</div>` : ''}
    <div class="type-badge">${item.type || (isDictionary ? 'Tra từ' : 'Từ vựng')}</div>
    <div class="meaning-large" id="meaningContainer${isDictionary ? 'Dict' : ''}" style="margin-bottom: 12px;">${meaningHtml}</div>
    ${item.lesson ? `<div class="meta-tag">Bài ${item.lesson}</div>` : ''}

    <!-- Mnemonics & Radicals -->
    ${mnemonicsHtml ? `
      <div class="mnemonics-box" style="width:100%; margin-top: 12px; margin-bottom: 16px; border-top: 1px solid var(--border-card); padding-top: 12px;">
        <div style="font-weight: 700; font-size: 11px; color: var(--text-secondary); margin-bottom: 6px; text-transform: uppercase; text-align:left; letter-spacing: 0.5px;">💡 ${lang === 'vi' ? 'Mẹo nhớ chữ Hán' : 'Mnemonic Hook'}</div>
        ${mnemonicsHtml}
      </div>
    ` : ''}

    ${radicalsHtml ? `
      <div class="radicals-box" style="width:100%; margin-bottom: 16px; border-top: 1px solid var(--border-card); padding-top: 12px;">
        ${radicalsHtml}
      </div>
    ` : ''}

    <div class="examples-box">
      <div class="examples-title">📌 Ví dụ</div>
      <div id="examplesContainer${isDictionary ? 'Dict' : ''}">${examplesHtml}</div>
    </div>
  `;

  renderHanziWriter(strokeContainerId, item.hanzi, window.innerWidth <= 480 ? 110 : 140);
}

function selectWord(index) {
  if (index < 0 || index >= currentVocabList.length) return;
  activeIndex = index;
  renderTopBar();

  const activeChip = document.getElementById(`chip-${index}`);
  if (activeChip) {
    activeChip.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }

  const item = currentVocabList[index];

  // WARM UP CACHE
  if (!item.meaning || item.meaning === 'Đang dịch...') {
    const cached = localStorage.getItem(`vocab_cache_${item.hanzi}`);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (parsed.meaning && parsed.meaning !== 'Đang dịch...' && parsed.meaning !== 'Từ vựng') {
          item.meaning = parsed.meaning;
          item.examples = parsed.examples || [];
          item.type = item.type || parsed.type;
        }
      } catch (e) {}
    }
  }

  renderWordToCard(item, 'detailCard', 'strokeContainer', false);
}

function nextWord() {
  if (activeIndex < currentVocabList.length - 1) {
    selectWord(activeIndex + 1);
  }
}

function prevWord() {
  if (activeIndex > 0) {
    selectWord(activeIndex - 1);
  }
}

/* GESTURES (SWIPE / DRAG) */
let startX = 0;
let startY = 0;
let isDragging = false;

const detailCard = document.getElementById('detailCard');
const quizPanel = document.getElementById('quizPanel');

function bindSwipeEvents(element) {
  if (!element) return;
  
  element.addEventListener('touchstart', (e) => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, { passive: true });

  element.addEventListener('touchend', (e) => {
    const endX = e.changedTouches[0].clientX;
    const endY = e.changedTouches[0].clientY;
    handleSwipe(startX, startY, endX, endY);
  }, { passive: true });

  element.addEventListener('mousedown', (e) => {
    startX = e.clientX;
    startY = e.clientY;
    isDragging = true;
  });
}

bindSwipeEvents(detailCard);
bindSwipeEvents(quizPanel);

document.addEventListener('mouseup', (e) => {
  if (!isDragging) return;
  isDragging = false;
  handleSwipe(startX, startY, e.clientX, e.clientY);
});

function handleSwipe(sX, sY, eX, eY) {
  const diffX = eX - sX;
  const diffY = eY - sY;

  if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 40) {
    if (currentView === 'vocab') {
      if (diffX < 0) nextWord();
      else prevWord();
    } else if (currentView === 'flashcard') {
      if (diffX < 0) nextFlashcard();
      else prevFlashcard();
    }
  }
}

/* KEYBOARD CONTROL */
document.addEventListener('keydown', (e) => {
  if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'SELECT') return;

  if (e.key === 'ArrowRight') {
    if (currentView === 'vocab') nextWord();
    else nextFlashcard();
  } else if (e.key === 'ArrowLeft') {
    if (currentView === 'vocab') prevWord();
    else prevFlashcard();
  } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    if (currentView === 'vocab' && activeIndex !== -1) {
      speakZh(currentVocabList[activeIndex].hanzi);
    }
  } else if (e.key === ' ' && currentView === 'flashcard') {
    e.preventDefault();
    flipFlashcard();
  }
});

function filterVocabulary(explicitKeyword = null) {
  const keyword = typeof explicitKeyword === 'string' ? explicitKeyword.trim().toLowerCase() : document.getElementById('searchInput').value.trim().toLowerCase();

  if (!keyword) {
    currentVocabList = [...originalVocabList];
  } else {
    currentVocabList = originalVocabList.filter(item =>
      item.hanzi.toLowerCase().includes(keyword) ||
      (item.pinyin && item.pinyin.toLowerCase().includes(keyword)) ||
      (item.meaning && item.meaning.toLowerCase().includes(keyword)) ||
      (item.type || '').toLowerCase().includes(keyword)
    );
  }

  activeIndex = -1;
  renderTopBar();
  initFlashcards();

  if (currentVocabList.length > 0) {
    selectWord(0);
    proposePreFetch();
  } else {
    document.getElementById('detailCard').innerHTML =
      '<div style="color: var(--text-muted); font-weight: 500;">Không tìm thấy từ phù hợp</div>';
  }
}

function handleVocabInput() {
  const input = document.getElementById('searchInput').value.trim().toLowerCase();
  const suggBox = document.getElementById('vocabSuggestions');
  
  if (!input) {
    suggBox.style.display = 'none';
    filterVocabulary('');
    return;
  }

  const matches = originalVocabList.filter(item => 
    item.hanzi.toLowerCase().includes(input) || 
    (item.pinyin && item.pinyin.toLowerCase().includes(input)) || 
    (item.meaning && item.meaning.toLowerCase().includes(input)) ||
    (item.type && item.type.toLowerCase().includes(input))
  ).slice(0, 6);

  const lang = appSettings.lang || 'vi';
  const searchOnlineText = lang === 'en' ? `🌐 Search online for "${input}"` : `🌐 Tra cứu trực tuyến "${input}"`;

  let html = '';
  if (matches.length > 0) {
    html = matches.map(m => `
      <div class="suggestion-item" data-val="${escapeHtml(m.hanzi)}" onclick="selectVocabSuggestion(this.getAttribute('data-val'))">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span class="sugg-hanzi">${m.hanzi} <span class="sugg-pinyin">${m.pinyin || ''}</span></span>
          <span style="font-size: 10px; background: var(--bg-body); padding: 2px 6px; border-radius: 6px; color: var(--text-secondary);">Bài ${m.lesson}</span>
        </div>
        <div class="sugg-meaning">${m.meaning && m.meaning !== 'Đang dịch...' ? m.meaning : ''}</div>
      </div>
    `).join('');
  }
  
  html += `
    <div class="suggestion-item" data-val="${escapeHtml(input)}" onclick="selectVocabSuggestion(this.getAttribute('data-val'), true)" style="text-align: center; color: var(--accent); font-weight: 600;">
      ${searchOnlineText}
    </div>
  `;
  
  suggBox.innerHTML = html;
  suggBox.style.display = 'flex';
}

function selectVocabSuggestion(val, forceSearch = false) {
  const input = document.getElementById('searchInput');
  if (input) input.value = val;
  const suggBox = document.getElementById('vocabSuggestions');
  if (suggBox) suggBox.style.display = 'none';
  
  if (currentView !== 'vocab') {
    switchView('vocab');
  }

  if (forceSearch) {
    executeOnlineSearch(val);
  } else {
    filterVocabulary(val);
  }
}

function toggleSidebarDesktop() {
  const sidebar = document.querySelector('.app-sidebar');
  if (!sidebar) return;
  sidebar.classList.toggle('collapsed');
  const icon = document.getElementById('sidebarToggleIcon');
  if (icon) {
    icon.textContent = sidebar.classList.contains('collapsed') ? '»' : '«';
  }
}

function toggleSidebarMobile() {
  const sidebar = document.querySelector('.app-sidebar');
  if (sidebar) sidebar.classList.toggle('mobile-open');
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('#searchWrapper')) {
    const vocabBox = document.getElementById('vocabSuggestions');
    if (vocabBox) vocabBox.style.display = 'none';
  }
  
  // Close mobile sidebar on backdrop click
  const sidebar = document.querySelector('.app-sidebar');
  const mobileBtn = document.querySelector('.mobile-menu-btn');
  if (window.innerWidth <= 768 && sidebar && sidebar.classList.contains('mobile-open')) {
    if (!sidebar.contains(e.target) && (!mobileBtn || !mobileBtn.contains(e.target))) {
      sidebar.classList.remove('mobile-open');
    }
  }
});

async function executeOnlineSearch(query) {
  if (!query) return;

  // Clear current list to show only the searched word
  currentVocabList = [];
  activeIndex = -1;
  renderTopBar();

  const card = document.getElementById('detailCard');
  if (card) {
    card.innerHTML = `<div style="text-align:center; padding: 40px;"><div class="loader" style="width: 30px; height: 30px; border-width: 3px; border-color: var(--border-input); border-top-color: var(--accent); margin: 0 auto 16px auto;"></div><div style="color: var(--text-muted); font-weight: 500;">Đang tra cứu "${query}"...</div></div>`;
  }

  let hanzi = query;
  const hasChinese = /[\u4e00-\u9fa5]/.test(query);

  if (!hasChinese) {
    try {
      const transUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(query)}&langpair=vi|zh-CN`;
      const transRes = await fetch(transUrl);
      if (transRes.ok) {
        const transData = await transRes.json();
        if (transData && transData.responseData && transData.responseData.translatedText) {
          hanzi = transData.responseData.translatedText.trim();
        } else {
          throw new Error('No translation found');
        }
      } else {
        throw new Error('API Error');
      }
    } catch (err) {
      if (card) {
        card.innerHTML = `<div style="color: #ef4444; font-weight: 500; text-align: center;">Không tìm thấy kết quả tiếng Trung phù hợp cho "${query}".</div>`;
      }
      return;
    }
  }

  let pinyin = '';
  if (window.pinyinPro) {
    pinyin = window.pinyinPro.pinyin(hanzi);
  }

  const searchedWord = {
    hanzi: hanzi,
    pinyin: pinyin,
    type: 'Tra cứu trực tuyến',
    lesson: 'Tra từ'
  };

  currentVocabList = [searchedWord];
  activeIndex = 0;
  renderTopBar();
  
  // Pass true for isDictionary to hide Edit/Delete buttons since it's not in the real DB
  renderWordToCard(searchedWord, 'detailCard', 'strokeContainer', true);

  try {
    const data = await getOnlineVocabData(hanzi);
    searchedWord.meaning = data.meaning;
    searchedWord.examples = data.examples;
    searchedWord.type = data.type;
    
    renderWordToCard(searchedWord, 'detailCard', 'strokeContainer', true);
  } catch (err) {
    console.error('Online search failed:', err);
    if (card) {
      const meaningContainer = document.getElementById('meaningContainer');
      if (meaningContainer) meaningContainer.innerHTML = `<span style="color: #ef4444;">❌ Lỗi khi tải chi tiết.</span>`;
    }
  }
}

let currentStreak = 0;
let maxStreak = 0;
let srsQueue = [];

function initFlashcards() {
  fcList = [...currentVocabList];
  shuffleArray(fcList);
  srsQueue = [...fcList]; // Used to re-inject failed cards
  fcIndex = 0;
  isFlipped = false;
  quizAnswered = false;
  currentStreak = 0;
  renderFlashcard();
}

function shuffleArray(array) {
  if (!Array.isArray(array)) return [];
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function shuffleFlashcards() {
  shuffleArray(fcList);
  srsQueue = [...fcList];
  fcIndex = 0;
  isFlipped = false;
  quizAnswered = false;
  currentStreak = 0;
  renderFlashcard();
}

function flipFlashcard() {
  if (fcMode === 'quiz') return;
  if (!fcList.length) return;
  isFlipped = !isFlipped;
  renderFlashcard();
}

function nextFlashcard() {
  if (fcIndex < fcList.length - 1) {
    fcIndex++;
    isFlipped = false;
    quizAnswered = false;
    renderFlashcard();
  } else if (fcMode === 'quiz' && srsQueue.length > fcList.length) {
    // Basic SRS: We have extra failed items appended
    fcIndex++;
    isFlipped = false;
    quizAnswered = false;
    renderFlashcard();
  }
}

function prevFlashcard() {
  if (fcIndex > 0) {
    fcIndex--;
    isFlipped = false;
    quizAnswered = false;
    renderFlashcard();
  }
}

function switchFlashcardMode(mode) {
  fcMode = mode;
  document.querySelectorAll('#fcModesContainer .sidebar-subtab').forEach(btn => btn.classList.remove('active'));
  
  if (mode === 'flashcard') {
    document.getElementById('btn-mode-fc').classList.add('active');
  } else if (mode === 'quiz') {
    document.getElementById('btn-mode-quiz').classList.add('active');
  } else if (mode === 'meaning') {
    document.getElementById('btn-mode-meaning').classList.add('active');
  } else if (mode === 'listen') {
    document.getElementById('btn-mode-listen').classList.add('active');
  } else {
    document.getElementById('btn-mode-write').classList.add('active');
  }

  isFlipped = false;
  quizAnswered = false;
  currentQuizCharIndex = 0;
  if (activeWriterQuiz) {
    try {
      activeWriterQuiz.cancelQuiz();
    } catch (e) {}
  }
  renderFlashcard();
}

const TONE_MAP = {
  'a': ['ā', 'á', 'ǎ', 'à', 'a'],
  'e': ['ē', 'é', 'ě', 'è', 'e'],
  'i': ['ī', 'í', 'ǐ', 'ì', 'i'],
  'o': ['ō', 'ó', 'ǒ', 'ò', 'o'],
  'u': ['ū', 'ú', 'ǔ', 'ù', 'u'],
  'v': ['ǖ', 'ǘ', 'ǚ', 'ǜ', 'ü'],
  'ü': ['ǖ', 'ǘ', 'ǚ', 'ǜ', 'ü'],
  'A': ['Ā', 'Á', 'Ǎ', 'À', 'A'],
  'E': ['Ē', 'É', 'Ě', 'È', 'E'],
  'I': ['Ī', 'Í', 'Ǐ', 'Ì', 'I'],
  'O': ['Ō', 'Ó', 'Ǒ', 'Ò', 'O'],
  'U': ['Ū', 'Ú', 'Ǔ', 'Ù', 'U'],
  'V': ['Ǖ', 'Ǘ', 'Ǚ', 'Ǜ', 'Ü'],
  'Ü': ['Ǖ', 'Ǘ', 'Ǚ', 'Ǜ', 'Ü']
};

const TONED_CHARS = {
  'ā': { base: 'a', tone: 1 }, 'á': { base: 'a', tone: 2 }, 'ǎ': { base: 'a', tone: 3 }, 'à': { base: 'a', tone: 4 },
  'ē': { base: 'e', tone: 1 }, 'é': { base: 'e', tone: 2 }, 'ě': { base: 'e', tone: 3 }, 'è': { base: 'e', tone: 4 },
  'ī': { base: 'i', tone: 1 }, 'í': { base: 'i', tone: 2 }, 'ǐ': { base: 'i', tone: 3 }, 'ì': { base: 'i', tone: 4 },
  'ō': { base: 'o', tone: 1 }, 'ó': { base: 'o', tone: 2 }, 'ǒ': { base: 'o', tone: 3 }, 'ò': { base: 'o', tone: 4 },
  'ū': { base: 'u', tone: 1 }, 'ú': { base: 'u', tone: 2 }, 'ǔ': { base: 'u', tone: 3 }, 'ù': { base: 'u', tone: 4 },
  'ǖ': { base: 'v', tone: 1 }, 'ǘ': { base: 'v', tone: 2 }, 'ǚ': { base: 'v', tone: 3 }, 'ǜ': { base: 'v', tone: 4 },
  'ü': { base: 'v', tone: 5 },
  'Ā': { base: 'A', tone: 1 }, 'Á': { base: 'A', tone: 2 }, 'Ǎ': { base: 'A', tone: 3 }, 'À': { base: 'A', tone: 4 },
  'Ē': { base: 'E', tone: 1 }, 'É': { base: 'E', tone: 2 }, 'Ě': { base: 'E', tone: 3 }, 'È': { base: 'E', tone: 4 },
  'Ī': { base: 'I', tone: 1 }, 'Í': { base: 'I', tone: 2 }, 'Ǐ': { base: 'I', tone: 3 }, 'Ì': { base: 'I', tone: 4 },
  'Ō': { base: 'O', tone: 1 }, 'Ó': { base: 'O', tone: 2 }, 'Ǒ': { base: 'O', tone: 3 }, 'Ò': { base: 'O', tone: 4 },
  'Ū': { base: 'U', tone: 1 }, 'Ú': { base: 'U', tone: 2 }, 'Ǔ': { base: 'U', tone: 3 }, 'Ù': { base: 'U', tone: 4 }
};

function changePinyinTones(pinyinStr, toneArray) {
  if (!pinyinStr) return '';
  let chars = Array.from(pinyinStr);
  let tonedIndices = [];

  chars.forEach((c, idx) => {
    if (TONED_CHARS[c]) {
      tonedIndices.push(idx);
    }
  });

  if (tonedIndices.length === 0) {
    const vowels = /[aeiouüvAEIOUÜV]/;
    chars.forEach((c, idx) => {
      if (vowels.test(c)) tonedIndices.push(idx);
    });
  }

  tonedIndices.forEach((charIdx, toneIdx) => {
    const originalChar = chars[charIdx];
    const info = TONED_CHARS[originalChar] || { base: originalChar, tone: 5 };
    const base = info.base;
    const targetTone = toneArray[toneIdx % toneArray.length];

    if (TONE_MAP[base]) {
      chars[charIdx] = TONE_MAP[base][targetTone - 1];
    }
  });

  return chars.join('');
}

function mutateSyllable(syllable) {
  if (!syllable) return [];
  let mutations = new Set();
  
  // Initials confusion
  if (syllable.startsWith('zh')) mutations.add('z' + syllable.slice(2));
  else if (syllable.startsWith('z')) mutations.add('zh' + syllable.slice(1));
  if (syllable.startsWith('ch')) mutations.add('c' + syllable.slice(2));
  else if (syllable.startsWith('c')) mutations.add('ch' + syllable.slice(1));
  if (syllable.startsWith('sh')) mutations.add('s' + syllable.slice(2));
  else if (syllable.startsWith('s')) mutations.add('sh' + syllable.slice(1));
  if (syllable.startsWith('l')) mutations.add('n' + syllable.slice(1));
  else if (syllable.startsWith('n')) mutations.add('l' + syllable.slice(1));
  if (syllable.startsWith('b')) mutations.add('p' + syllable.slice(1));
  else if (syllable.startsWith('p')) mutations.add('b' + syllable.slice(1));
  if (syllable.startsWith('d')) mutations.add('t' + syllable.slice(1));
  else if (syllable.startsWith('t')) mutations.add('d' + syllable.slice(1));
  if (syllable.startsWith('g')) mutations.add('k' + syllable.slice(1));
  else if (syllable.startsWith('k')) mutations.add('g' + syllable.slice(1));
  if (syllable.startsWith('j')) mutations.add('q' + syllable.slice(1));
  else if (syllable.startsWith('q')) mutations.add('j' + syllable.slice(1));

  // Finals confusion (an/ang, en/eng, in/ing)
  if (syllable.endsWith('ng')) mutations.add(syllable.slice(0, -1));
  else if (syllable.endsWith('n')) mutations.add(syllable + 'g');

  // Vowel confusion
  if (syllable.includes('uo')) mutations.add(syllable.replace('uo', 'ou'));
  else if (syllable.includes('ou')) mutations.add(syllable.replace('ou', 'uo'));
  if (syllable.includes('ie')) mutations.add(syllable.replace('ie', 'ei'));
  else if (syllable.includes('ei')) mutations.add(syllable.replace('ei', 'ie'));

  return Array.from(mutations);
}

function generateMeaningOptions(correctItem) {
  if (!correctItem) return ['', '', '', ''];
  const correctMeaning = correctItem.meaning || 'Nghĩa của từ';
  const pool = currentVocabList.filter(item => 
    item.hanzi !== correctItem.hanzi && 
    item.meaning && 
    item.meaning !== 'Đang dịch...' && 
    item.meaning !== 'Từ vựng'
  ).map(item => item.meaning);

  // Fallback if not enough words in current lesson
  if (pool.length < 3) {
    const allPool = originalVocabList.filter(item => 
      item.hanzi !== correctItem.hanzi && 
      item.meaning && 
      item.meaning !== 'Đang dịch...' && 
      item.meaning !== 'Từ vựng'
    ).map(item => item.meaning);
    pool.push(...allPool);
  }

  shuffleArray(pool);
  
  // Remove duplicates and slice top 3
  const uniquePool = Array.from(new Set(pool)).slice(0, 3);
  
  const allOptions = [correctMeaning, ...uniquePool];
  shuffleArray(allOptions);
  return allOptions;
}

function generateQuizOptions(correctItem) {
  if (!correctItem) return ['', '', '', ''];
  
  // Self-heal: generate Pinyin if missing
  if (!correctItem.pinyin && window.pinyinPro) {
    correctItem.pinyin = window.pinyinPro.pinyin(correctItem.hanzi);
  }
  
  const correctPinyin = correctItem.pinyin || '';
  if (!correctPinyin) {
    return [correctItem.hanzi, '', '', ''];
  }

  const targetTones = [1, 2, 3, 4];
  const uniqueOptions = new Set();

  // 1. Generate smart confusable pronunciation mistakes
  const syllables = correctPinyin.split(' ');
  for (let i = 0; i < syllables.length; i++) {
    let muts = mutateSyllable(syllables[i]);
    for (let m of muts) {
      let newWords = [...syllables];
      newWords[i] = m;
      let mutatedPinyin = newWords.join(' ');
      uniqueOptions.add(mutatedPinyin);
      // Also add a variant with a wrong tone for extra trickiness
      uniqueOptions.add(changePinyinTones(mutatedPinyin, [ (i % 4) + 1 ]));
    }
  }

  // 2. Generate pure tone mistakes (same pronunciation, wrong tones)
  targetTones.forEach(tone => {
    const altered = changePinyinTones(correctPinyin, [tone, tone]);
    uniqueOptions.add(altered);
  });

  // Remove the correct answer from the pool just in case it got generated
  let wrongArray = Array.from(uniqueOptions).filter(x => x !== correctPinyin);
  shuffleArray(wrongArray);
  let wrongOptions = wrongArray.slice(0, 3);

  // Fallback: If not enough options, generate random tone combos
  let toneCombo = 1;
  while (wrongOptions.length < 3 && toneCombo <= 4) {
    const altered = changePinyinTones(correctPinyin, [toneCombo, 5 - toneCombo]);
    if (altered !== correctPinyin && !wrongOptions.includes(altered)) {
      wrongOptions.push(altered);
    }
    toneCombo++;
  }

  const allOptions = [correctPinyin, ...wrongOptions];
  shuffleArray(allOptions);
  return allOptions;
}

function selectQuizOption(opt) {
  if (quizAnswered) return;
  quizAnswered = true;

  const item = srsQueue[fcIndex]; // Use srsQueue instead of fcList
  const isCorrect = opt === item.pinyin;

  const buttons = document.querySelectorAll('.quiz-option-btn');
  buttons.forEach(btn => {
    btn.disabled = true;
    if (btn.dataset.val === item.pinyin) {
      if (isCorrect) {
        btn.classList.add('correct-blink');
      } else {
        btn.classList.add('correct');
      }
    } else if (btn.dataset.val === opt && !isCorrect) {
      btn.classList.add('incorrect');
    }
  });

  const feedback = document.getElementById('quizFeedback');
  if (feedback) {
    if (isCorrect) {
      currentStreak++;
      if (currentStreak > maxStreak) maxStreak = currentStreak;
      playSuccessSound();
      const streakHtml = currentStreak > 2 ? ` <span style="color: #f59e0b; font-weight: 700;">(🔥 ${currentStreak} Combo!)</span>` : '';
      feedback.innerHTML = `<span style="color: #10b981; font-weight: 700; font-size: 15px;">🎉 Chính xác!${streakHtml}</span>`;
      speakZh(item.hanzi);
    } else {
      currentStreak = 0;
      playFailureSound();
      feedback.innerHTML = `<span style="color: #ef4444; font-weight: 700; font-size: 15px;">❌ Sai rồi!</span>`;
      speakZh(item.hanzi);

      // SRS: Push the failed item to the back of the queue so they have to review it again
      srsQueue.push(item);
      document.getElementById('fcProgress').innerText = `${fcIndex + 1} / ${srsQueue.length}`;
    }

    // Auto-advance after 1.8s delay
    setTimeout(() => {
      if ((fcMode === 'quiz' || fcMode === 'listen') && quizAnswered) {
        if (fcIndex < srsQueue.length - 1) {
          fcIndex++;
          isFlipped = false;
          quizAnswered = false;
          renderFlashcard();
        } else {
          feedback.innerHTML = `<span style="color: #3b82f6; font-weight: 700; font-size: 15px;">🏆 Bạn đã hoàn thành bài ôn tập!</span>`;
        }
      }
    }, 1800);
  }
}

function selectMeaningOption(opt) {
  if (quizAnswered) return;
  quizAnswered = true;

  const item = srsQueue[fcIndex];
  const isCorrect = opt === item.meaning;

  const buttons = document.querySelectorAll('.quiz-option-btn');
  buttons.forEach(btn => {
    btn.disabled = true;
    if (btn.dataset.val === item.meaning) {
      if (isCorrect) {
        btn.classList.add('correct-blink');
      } else {
        btn.classList.add('correct');
      }
    } else if (btn.dataset.val === opt && !isCorrect) {
      btn.classList.add('incorrect');
    }
  });

  const feedback = document.getElementById('quizFeedback');
  if (feedback) {
    if (isCorrect) {
      currentStreak++;
      if (currentStreak > maxStreak) maxStreak = currentStreak;
      playSuccessSound();
      const streakHtml = currentStreak > 2 ? ` <span style="color: #f59e0b; font-weight: 700;">(🔥 ${currentStreak} Combo!)</span>` : '';
      feedback.innerHTML = `<span style="color: #10b981; font-weight: 700; font-size: 15px;">🎉 Chính xác!${streakHtml}</span>`;
    } else {
      currentStreak = 0;
      playFailureSound();
      feedback.innerHTML = `<span style="color: #ef4444; font-weight: 700; font-size: 15px;">❌ Sai rồi!</span>`;

      // SRS queue push back
      srsQueue.push(item);
      document.getElementById('fcProgress').innerText = `${fcIndex + 1} / ${srsQueue.length}`;
    }

    setTimeout(() => {
      if (fcMode === 'meaning' && quizAnswered) {
        if (fcIndex < srsQueue.length - 1) {
          fcIndex++;
          isFlipped = false;
          quizAnswered = false;
          renderFlashcard();
        } else {
          feedback.innerHTML = `<span style="color: #3b82f6; font-weight: 700; font-size: 15px;">🏆 Bạn đã hoàn thành bài ôn tập!</span>`;
        }
      }
    }, 1800);
  }
}

function playSuccessSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
    osc.frequency.setValueAtTime(880, ctx.currentTime + 0.1); // A5
    
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch (e) {
    console.error('AudioContext error:', e);
  }
}

function playFailureSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(100, ctx.currentTime + 0.25);
    
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch (e) {
    console.error('AudioContext error:', e);
  }
}

function renderFlashcard() {
  const fcCard = document.getElementById('fcCard');
  const quizPanel = document.getElementById('quizPanel');
  const writePanel = document.getElementById('writePanel');
  const progress = document.getElementById('fcProgress');

  if (!fcList.length) {
    progress.innerText = '0 / 0';
    if (fcMode === 'flashcard') {
      fcCard.style.display = 'flex';
      quizPanel.style.display = 'none';
      writePanel.style.display = 'none';
      document.getElementById('fcContent').innerHTML = '<div style="color: var(--text-muted);">Không có từ vựng</div>';
    } else if (fcMode === 'quiz' || fcMode === 'meaning' || fcMode === 'listen') {
      fcCard.style.display = 'none';
      quizPanel.style.display = 'flex';
      writePanel.style.display = 'none';
      document.getElementById('quizOptions').innerHTML = '';
      document.getElementById('quizFeedback').innerHTML = '<div style="color: var(--text-muted);">Không có từ vựng</div>';
    } else {
      fcCard.style.display = 'none';
      quizPanel.style.display = 'none';
      writePanel.style.display = 'flex';
      document.getElementById('writeCanvasContainer').innerHTML = '';
      document.getElementById('writeFeedback').innerHTML = '<div style="color: var(--text-muted);">Không có từ vựng</div>';
    }
    return;
  }

  const item = srsQueue[fcIndex];
  if (!item) {
    progress.innerText = '0 / 0';
    if (fcMode === 'flashcard') {
      fcCard.style.display = 'flex';
      quizPanel.style.display = 'none';
      writePanel.style.display = 'none';
      document.getElementById('fcContent').innerHTML = '<div style="color: var(--text-muted);">Không có từ vựng</div>';
    } else if (fcMode === 'quiz' || fcMode === 'meaning' || fcMode === 'listen') {
      fcCard.style.display = 'none';
      quizPanel.style.display = 'flex';
      writePanel.style.display = 'none';
      document.getElementById('quizOptions').innerHTML = '';
      document.getElementById('quizFeedback').innerHTML = '<div style="color: var(--text-muted);">Không có từ vựng</div>';
    } else {
      fcCard.style.display = 'none';
      quizPanel.style.display = 'none';
      writePanel.style.display = 'flex';
      document.getElementById('writeCanvasContainer').innerHTML = '';
      document.getElementById('writeFeedback').innerHTML = '<div style="color: var(--text-muted);">Không có từ vựng</div>';
    }
    return;
  }
  progress.innerText = `${fcIndex + 1} / ${srsQueue.length}`;

  if (fcMode === 'flashcard') {
    fcCard.style.display = 'flex';
    quizPanel.style.display = 'none';
    writePanel.style.display = 'none';
    const container = document.getElementById('fcContent');

    if (!isFlipped) {
      container.innerHTML = `
        <div class="fc-stroke-container" id="fcStrokeContainer"></div>
        <button class="audio-btn-lg" data-zh="${escapeHtml(item.hanzi)}" onclick="speakZh(this.getAttribute('data-zh'), event)" style="margin-top:8px;">🔊</button>
        <div class="fc-pinyin">${item.pinyin}</div>
      `;
      renderHanziWriter('fcStrokeContainer', item.hanzi, 110);
    } else {
      // If flipped and meaning is not loaded yet, show lazy load trigger
      if (!item.meaning || !item.examples || item.meaning === 'Đang dịch...') {
        container.innerHTML = `
          <div class="fc-pinyin" style="font-size:20px;">${item.pinyin}</div>
          <div class="fc-type">${item.type || 'Từ vựng'}</div>
          <div class="fc-meaning" id="fcMeaningContainer" style="cursor: pointer; color: var(--accent); font-weight: 700; margin-top: 10px; font-size: 18px;" onclick="lazyLoadFlashcard(${fcIndex})">🔍 Bấm để tải nghĩa...</div>
          <div class="fc-lesson">Bài ${item.lesson}</div>
          <button class="audio-btn-lg" data-zh="${escapeHtml(item.hanzi)}" onclick="speakZh(this.getAttribute('data-zh'), event)" style="margin-top:12px;">🔊</button>
        `;
        return;
      }

      container.innerHTML = `
        <div class="fc-pinyin" style="font-size:20px;">${item.pinyin}</div>
        <div class="fc-type">${item.type || 'Từ vựng'}</div>
        <div class="fc-meaning">${item.meaning}</div>
        <div class="fc-lesson">Bài ${item.lesson}</div>
        <button class="audio-btn-lg" data-zh="${escapeHtml(item.hanzi)}" onclick="speakZh(this.getAttribute('data-zh'), event)" style="margin-top:12px;">🔊</button>
      `;
    }
  } else if (fcMode === 'quiz') {
    // Quiz Mode (Pinyin)
    fcCard.style.display = 'none';
    quizPanel.style.display = 'flex';
    writePanel.style.display = 'none';

    document.getElementById('quizStrokeContainer').innerHTML = '';
    renderHanziWriter('quizStrokeContainer', item.hanzi, 110);

    const options = generateQuizOptions(item);
    const optionsContainer = document.getElementById('quizOptions');
    optionsContainer.innerHTML = options.map(opt => `
      <button class="quiz-option-btn" data-val="${escapeHtml(opt)}" onclick="selectQuizOption(this.getAttribute('data-val'))">${escapeHtml(opt)}</button>
    `).join('');

    document.getElementById('quizFeedback').innerHTML = '';
  } else if (fcMode === 'meaning') {
    // Meaning Quiz
    fcCard.style.display = 'none';
    quizPanel.style.display = 'flex';
    writePanel.style.display = 'none';

    document.getElementById('quizStrokeContainer').innerHTML = '';
    renderHanziWriter('quizStrokeContainer', item.hanzi, 110);

    const options = generateMeaningOptions(item);
    const optionsContainer = document.getElementById('quizOptions');
    optionsContainer.innerHTML = options.map(opt => `
      <button class="quiz-option-btn" data-val="${escapeHtml(opt)}" onclick="selectMeaningOption(this.getAttribute('data-val'))">${escapeHtml(opt)}</button>
    `).join('');

    document.getElementById('quizFeedback').innerHTML = '';
  } else if (fcMode === 'listen') {
    // Listening Quiz
    fcCard.style.display = 'none';
    quizPanel.style.display = 'flex';
    writePanel.style.display = 'none';

    const strokeContainer = document.getElementById('quizStrokeContainer');
    strokeContainer.innerHTML = `
      <div style="font-size: 64px; cursor: pointer; text-align: center; color: var(--accent); padding: 20px;" data-zh="${escapeHtml(item.hanzi)}" onclick="speakZh(this.getAttribute('data-zh'), event)">🔊</div>
    `;
    speakZh(item.hanzi);

    const options = generateQuizOptions(item);
    const optionsContainer = document.getElementById('quizOptions');
    optionsContainer.innerHTML = options.map(opt => `
      <button class="quiz-option-btn" data-val="${escapeHtml(opt)}" onclick="selectQuizOption(this.getAttribute('data-val'))">${escapeHtml(opt)}</button>
    `).join('');

    document.getElementById('quizFeedback').innerHTML = '';
  } else {
    // Write Mode
    fcCard.style.display = 'none';
    quizPanel.style.display = 'none';
    writePanel.style.display = 'flex';

    renderWriteQuiz();
  }
}

function renderHanziWriter(containerId, text, boxSize) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';

  text.split('').forEach((char, idx) => {
    if (/[\u4e00-\u9fa5]/.test(char)) {
      const wrapper = document.createElement('div');
      wrapper.className = 'writer-box';
      wrapper.style.width = boxSize + 'px';
      wrapper.style.height = boxSize + 'px';

      wrapper.innerHTML = `
        <svg class="grid" viewBox="0 0 100 100">
          <line x1="0" y1="50" x2="100" y2="50" stroke="var(--grid-line)" stroke-dasharray="2,2" stroke-width="0.8"/>
          <line x1="50" y1="0" x2="50" y2="100" stroke="var(--grid-line)" stroke-dasharray="2,2" stroke-width="0.8"/>
          <line x1="0" y1="0" x2="100" y2="100" stroke="var(--grid-line)" stroke-dasharray="2,2" stroke-width="0.8"/>
          <line x1="100" y1="0" x2="0" y2="100" stroke="var(--grid-line)" stroke-dasharray="2,2" stroke-width="0.8"/>
        </svg>
        <div id="${containerId}-target-${idx}" class="target"></div>
      `;
      container.appendChild(wrapper);

      const writer = HanziWriter.create(`${containerId}-target-${idx}`, char, {
        width: boxSize,
        height: boxSize,
        padding: 6,
        showOutline: true,
        strokeColor: getComputedStyle(document.documentElement).getPropertyValue('--stroke-color').trim() || '#0b1a33',
        outlineColor: getComputedStyle(document.documentElement).getPropertyValue('--outline-color').trim() || '#e2e8f0',
        strokeAnimationSpeed: appSettings.strokeSpeed,
        delayBetweenStrokes: 25
      });
      writer.animateCharacter();

      wrapper.onclick = (e) => {
        e.stopPropagation();
        writer.animateCharacter();
        speakZh(char);
      };
    }
  });
}

function applyTheme(isDark) {
  const root = document.documentElement;
  if (isDark) root.classList.add('dark');
  else root.classList.remove('dark');

  localStorage.setItem('theme', isDark ? 'dark' : 'light');
  const btn = document.getElementById('themeToggle');
  if (btn) {
    const iconSpan = btn.querySelector('.tab-icon');
    if (iconSpan) {
      iconSpan.textContent = isDark ? '☀️' : '🌓';
    } else {
      btn.textContent = isDark ? '☀️' : '🌓';
    }
  }

  if (activeIndex !== -1 && currentVocabList[activeIndex]) {
    renderHanziWriter('strokeContainer', currentVocabList[activeIndex].hanzi, window.innerWidth <= 480 ? 110 : 140);
  }
  if (currentView === 'flashcard') renderFlashcard();
}

function toggleTheme() {
  applyTheme(!document.documentElement.classList.contains('dark'));
}

function setThemeFromSystem() {
  const stored = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(stored ? stored === 'dark' : prefersDark);
}

window.addEventListener('DOMContentLoaded', () => {
  setThemeFromSystem();
  loadSettings();
  populateVoices();
  discoverLessons();
});

/* SETTINGS & STATE CONTROLLERS */
function toggleSettingsModal() {
  const modal = document.getElementById('settingsModal');
  if (modal) {
    modal.classList.toggle('active');
    if (modal.classList.contains('active')) {
      populateVoices();
      updateCacheSizeDisplay();
    }
  }
}

function getCacheSize() {
  let totalBytes = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('vocab_cache_')) {
      const val = localStorage.getItem(key) || '';
      totalBytes += (key.length + val.length) * 2; // UTF-16 characters use 2 bytes
    }
  }
  
  if (totalBytes === 0) return '0 KB';
  const kb = totalBytes / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(1)} KB`;
  }
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

function updateCacheSizeDisplay() {
  const span = document.getElementById('cacheSizeText');
  if (span) {
    span.textContent = `Dung lượng đệm đang dùng: ${getCacheSize()}`;
  }
}

function updateSpeedLabel() {
  const speed = parseFloat(document.getElementById('speechSpeed').value);
  document.getElementById('speedVal').textContent = speed.toFixed(1);
}

function updateStrokeSpeedLabel() {
  const speed = parseFloat(document.getElementById('strokeSpeed').value);
  document.getElementById('strokeSpeedVal').textContent = speed.toFixed(1);
}

function populateVoices() {
  if (!('speechSynthesis' in window)) return;
  const voiceSelect = document.getElementById('voiceSelect');
  if (!voiceSelect) return;

  // Get all voices
  const voices = window.speechSynthesis.getVoices();
  voiceSelect.innerHTML = '';

  // Filter Chinese voices (Mandarin/Cantonese)
  const zhVoices = voices.filter(v => v.lang.includes('zh') || v.lang.includes('ZH') || v.lang.includes('cmn'));

  if (zhVoices.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'Mặc định hệ thống';
    voiceSelect.appendChild(opt);
  } else {
    // If no voice is saved in settings, check if there is a Kangkang voice to make it the default!
    let defaultVoiceURI = appSettings.voiceURI;
    if (!defaultVoiceURI) {
      const kangkang = zhVoices.find(v => v.name.toLowerCase().includes('kangkang'));
      if (kangkang) {
        defaultVoiceURI = kangkang.voiceURI;
        appSettings.voiceURI = kangkang.voiceURI;
        localStorage.setItem('hanyu_settings', JSON.stringify(appSettings));
      }
    }

    zhVoices.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.voiceURI;
      opt.textContent = `${v.name} (${v.lang})`;
      if (v.voiceURI === defaultVoiceURI) {
        opt.selected = true;
      }
      voiceSelect.appendChild(opt);
    });
  }
}

if ('speechSynthesis' in window) {
  window.speechSynthesis.onvoiceschanged = populateVoices;
}

function loadSettings() {
  const stored = localStorage.getItem('hanyu_settings');
  if (stored) {
    try {
      appSettings = { ...appSettings, ...JSON.parse(stored) };
    } catch (e) {}
  }

  // Update HTML elements
  const langSelect = document.getElementById('langSelect');
  if (langSelect) {
    langSelect.value = appSettings.lang || 'vi';
  }

  const speechInput = document.getElementById('speechSpeed');
  if (speechInput) {
    speechInput.value = appSettings.speechSpeed;
    document.getElementById('speedVal').textContent = appSettings.speechSpeed.toFixed(1);
  }

  const strokeInput = document.getElementById('strokeSpeed');
  if (strokeInput) {
    strokeInput.value = appSettings.strokeSpeed;
    document.getElementById('strokeSpeedVal').textContent = appSettings.strokeSpeed.toFixed(1);
  }

  // Translate UI texts to chosen language
  applyLanguage();

  // Load HSK Radical/Sino-Vietnamese database in background
  loadHskDb();
}

async function loadHskDb() {
  if (hskCharDb && hskRadicalDb) return;
  try {
    const [resChar, resRad] = await Promise.all([
      fetch('https://cdn.jsdelivr.net/gh/binhbuithithanh/hanzi-sino-vietnamese@main/data/characters.json'),
      fetch('https://cdn.jsdelivr.net/gh/binhbuithithanh/hanzi-sino-vietnamese@main/data/radicals.json')
    ]);
    if (resChar.ok && resRad.ok) {
      hskCharDb = await resChar.json();
      hskRadicalDb = await resRad.json();
      console.log('✓ Loaded HSK Sino-Vietnamese Radical DB');
      if (activeIndex !== -1) {
        selectWord(activeIndex);
      }
    }
  } catch (e) {
    console.error('Failed to load HSK radical database:', e);
  }
}

function saveSettings() {
  appSettings.speechSpeed = parseFloat(document.getElementById('speechSpeed').value);
  appSettings.strokeSpeed = parseFloat(document.getElementById('strokeSpeed').value);

  const voiceSelect = document.getElementById('voiceSelect');
  if (voiceSelect) {
    appSettings.voiceURI = voiceSelect.value;
  }

  const langSelect = document.getElementById('langSelect');
  if (langSelect) {
    appSettings.lang = langSelect.value;
  }

  localStorage.setItem('hanyu_settings', JSON.stringify(appSettings));

  // Apply immediately to current view
  if (activeIndex !== -1 && currentVocabList[activeIndex]) {
    renderHanziWriter('strokeContainer', currentVocabList[activeIndex].hanzi, window.innerWidth <= 480 ? 110 : 140);
  }
  if (currentView === 'flashcard') {
    renderFlashcard();
  }
}

function clearVocabCache() {
  const lang = appSettings.lang || 'vi';
  if (confirm(TRANSLATIONS[lang].clearCacheConfirm)) {
    // 1. Immediately request cancellation of any active background sync!
    syncCancelRequested = true;
    hideSyncProposal();

    // 2. Clear all local storage keys starting with vocab_cache_
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith('vocab_cache_')) {
        localStorage.removeItem(key);
      }
    });

    // 3. Clear from memory
    currentVocabList.forEach(item => {
      delete item.meaning;
      delete item.examples;
    });

    alert(TRANSLATIONS[lang].clearCacheSuccess);
    updateCacheSizeDisplay();
    loadAndRenderData();
    toggleSettingsModal();
  }
}

/* BACKGROUND PRE-FETCHING SYNC QUEUE */
async function startPreFetchQueue() {
  if (syncQueueActive) {
    syncCancelRequested = true;
    await new Promise(r => setTimeout(r, 200));
  }

  syncCancelRequested = false;
  syncQueueActive = true;

  const listToSync = [...currentVocabList];
  const total = listToSync.length;

  if (total === 0) {
    updateSyncIndicator(0, 0, false);
    syncQueueActive = false;
    return;
  }

  // Pre-load anything already in localStorage to memory
  let cachedCount = listToSync.filter(item => {
    const cached = localStorage.getItem(`vocab_cache_${item.hanzi}`);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        item.meaning = parsed.meaning;
        item.examples = parsed.examples;
        item.type = item.type || parsed.type;
        return true;
      } catch (e) {}
    }
    return false;
  }).length;

  updateSyncIndicator(cachedCount, total, cachedCount < total);

  if (cachedCount === total) {
    syncQueueActive = false;
    return;
  }

  // Filter out items that are not synced yet
  const unsyncedItems = listToSync.filter(item => !item.meaning || !item.examples);

  if (unsyncedItems.length === 0) {
    syncQueueActive = false;
    return;
  }

  // Concurrency limit: 5 parallel requests
  const CONCURRENCY = 5;
  let index = 0;

  async function worker() {
    while (index < unsyncedItems.length && !syncCancelRequested) {
      const item = unsyncedItems[index++];
      if (!item) continue;

      // Double check cache in case it was loaded in parallel
      const cached = localStorage.getItem(`vocab_cache_${item.hanzi}`);
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          item.meaning = parsed.meaning;
          item.examples = parsed.examples;
          item.type = item.type || parsed.type;
          cachedCount++;
          updateSyncIndicator(cachedCount, total, true);
          continue;
        } catch (e) {}
      }

      try {
        const data = await getOnlineVocabData(item.hanzi);
        item.meaning = data.meaning;
        item.examples = data.examples;
        item.type = item.type || data.type;

        // If user is currently looking at this item, refresh the render
        if (activeIndex === currentVocabList.findIndex(x => x.hanzi === item.hanzi)) {
          selectWord(activeIndex);
        }

        cachedCount++;
        updateSyncIndicator(cachedCount, total, true);
      } catch (err) {
        console.error(`Failed to pre-fetch background word ${item.hanzi}:`, err);
      }
    }
  }

  // Start concurrent worker threads
  const workers = [];
  const activeWorkersCount = Math.min(CONCURRENCY, unsyncedItems.length);
  for (let i = 0; i < activeWorkersCount; i++) {
    workers.push(worker());
  }

  // Wait for all workers to complete
  await Promise.all(workers);

  updateSyncIndicator(cachedCount, total, false);
  syncQueueActive = false;
}

function updateSyncIndicator(count, total, isSyncing) {
  const badge = document.getElementById('syncIndicator');
  const text = document.getElementById('syncStatus');
  if (!badge || !text) return;

  if (total === 0) {
    badge.classList.remove('active');
    return;
  }

  text.textContent = `Sync: ${count} / ${total}`;
  badge.classList.add('active');

  if (isSyncing) {
    badge.classList.add('spinning');
  } else {
    badge.classList.remove('spinning');
    setTimeout(() => {
      if (!syncQueueActive && badge.classList.contains('active')) {
        badge.classList.remove('active');
      }
    }, 3000);
  }
}

/* SYNC PROPOSAL POPUP TOAST CONTROLLERS */
function proposePreFetch() {
  const listToSync = [...currentVocabList];
  const total = listToSync.length;
  if (total === 0) return;

  // Check how many are unsynced (ignoring broken cache entries)
  const unsyncedItems = listToSync.filter(item => {
    const cached = localStorage.getItem(`vocab_cache_${item.hanzi}`);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (parsed.meaning && parsed.meaning !== 'Đang dịch...' && parsed.meaning !== 'Từ vựng') {
          // Warm up memory with cached values
          item.meaning = parsed.meaning;
          item.examples = parsed.examples || [];
          item.type = item.type || parsed.type;
          return false;
        }
      } catch (e) {}
    }
    return true;
  });

  const unsyncedCount = unsyncedItems.length;

  if (unsyncedCount === 0) {
    // All items are fully cached already, no need to propose!
    hideSyncProposal();
    updateSyncIndicator(total, total, false);
    return;
  }

  // Show beautiful proposal toast
  const toast = document.getElementById('syncProposal');
  const msg = document.getElementById('proposalMessage');
  if (toast && msg) {
    msg.textContent = `Phát hiện có ${unsyncedCount} từ vựng chưa tải nghĩa và câu ví dụ trực tuyến. Bạn có muốn đồng bộ toàn bộ ngay bây giờ không?`;
    toast.classList.add('active');
  }
}

function acceptSyncProposal() {
  hideSyncProposal();
  startPreFetchQueue();
}

function declineSyncProposal() {
  hideSyncProposal();
  // Update status indicator for already-cached count, without starting fetch queue
  const listToSync = [...currentVocabList];
  const total = listToSync.length;
  const cachedCount = total - listToSync.filter(item => !item.meaning || !item.examples).length;
  updateSyncIndicator(cachedCount, total, false);
}

function hideSyncProposal() {
  const toast = document.getElementById('syncProposal');
  if (toast) {
    toast.classList.remove('active');
  }
}

/* ADMIN OPERATIONS & MODAL HANDLERS */
function openAddWordModal() {
  const selected = document.getElementById('lessonSelect').value;
  const lang = appSettings.lang || 'vi';
  if (selected === 'all') {
    alert(TRANSLATIONS[lang].addWordSelectAlert);
    return;
  }
  const modal = document.getElementById('addWordModal');
  if (modal) {
    document.getElementById('addWordInput').value = '';
    modal.classList.add('active');
  }
}

function closeAddWordModal() {
  const modal = document.getElementById('addWordModal');
  if (modal) modal.classList.remove('active');
}

function addWordSubmit() {
  const input = document.getElementById('addWordInput');
  const hanzi = input ? input.value.trim() : '';
  const lang = appSettings.lang || 'vi';
  if (!hanzi) {
    alert(TRANSLATIONS[lang].addWordAlert);
    return;
  }

  const selected = document.getElementById('lessonSelect').value;
  const lessonNum = parseInt(selected);

  const newWord = {
    lesson: lessonNum,
    hanzi: hanzi
  };

  if (window.pinyinPro) {
    newWord.pinyin = window.pinyinPro.pinyin(hanzi);
  }

  // Add to active lists
  currentVocabList.push(newWord);
  originalVocabList.push(newWord);

  // Save the full vocab list of this lesson to localStorage
  const lessonVocab = originalVocabList.filter(x => x.lesson === lessonNum);
  localStorage.setItem(`custom_vocab_lesson_${lessonNum}`, JSON.stringify(lessonVocab));

  closeAddWordModal();
  renderTopBar();
  selectWord(currentVocabList.length - 1);
  proposePreFetch();
}

function openEditWordModal() {
  const lang = appSettings.lang || 'vi';
  if (activeIndex === -1 || !currentVocabList[activeIndex]) {
    alert(TRANSLATIONS[lang].editWordSelectAlert);
    return;
  }
  const modal = document.getElementById('editWordModal');
  if (modal) {
    document.getElementById('editWordInput').value = currentVocabList[activeIndex].hanzi;
    modal.classList.add('active');
  }
}

function closeEditWordModal() {
  const modal = document.getElementById('editWordModal');
  if (modal) modal.classList.remove('active');
}

function editWordSubmit() {
  const input = document.getElementById('editWordInput');
  const hanzi = input ? input.value.trim() : '';
  const lang = appSettings.lang || 'vi';
  if (!hanzi) {
    alert(TRANSLATIONS[lang].addWordAlert);
    return;
  }

  const item = currentVocabList[activeIndex];
  const lessonNum = item.lesson;
  const oldHanzi = item.hanzi;

  item.hanzi = hanzi;
  // Clear computed translations/examples so they get re-fetched
  delete item.meaning;
  delete item.examples;

  if (window.pinyinPro) {
    item.pinyin = window.pinyinPro.pinyin(hanzi);
  }

  // Clear cache for this specific word so it doesn't load old definition
  localStorage.removeItem(`vocab_cache_${oldHanzi}`);
  localStorage.removeItem(`vocab_cache_${hanzi}`);

  // Find inside originalVocabList and update
  const origItem = originalVocabList.find(x => x.lesson === lessonNum && x.hanzi === oldHanzi);
  if (origItem) {
    origItem.hanzi = hanzi;
    origItem.pinyin = item.pinyin;
    delete origItem.meaning;
    delete origItem.examples;
  }

  // Save the full vocab list of this lesson to localStorage
  const lessonVocab = originalVocabList.filter(x => x.lesson === lessonNum);
  localStorage.setItem(`custom_vocab_lesson_${lessonNum}`, JSON.stringify(lessonVocab));

  closeEditWordModal();
  renderTopBar();
  selectWord(activeIndex);
  proposePreFetch();
}

function deleteCurrentWord() {
  const lang = appSettings.lang || 'vi';
  if (activeIndex === -1 || !currentVocabList[activeIndex]) {
    alert(TRANSLATIONS[lang].deleteWordSelectAlert);
    return;
  }

  const item = currentVocabList[activeIndex];
  const lessonNum = item.lesson;

  if (confirm(TRANSLATIONS[lang].deleteWordConfirm.replace('{word}', item.hanzi))) {
    // Remove from currentVocabList
    currentVocabList.splice(activeIndex, 1);

    // Remove from originalVocabList
    const origIdx = originalVocabList.findIndex(x => x.lesson === lessonNum && x.hanzi === item.hanzi);
    if (origIdx !== -1) {
      originalVocabList.splice(origIdx, 1);
    }

    // Save updated list of this lesson to localStorage
    const lessonVocab = originalVocabList.filter(x => x.lesson === lessonNum);
    localStorage.setItem(`custom_vocab_lesson_${lessonNum}`, JSON.stringify(lessonVocab));

    // Handle index bounds
    if (currentVocabList.length === 0) {
      activeIndex = -1;
      renderTopBar();
      document.getElementById('detailCard').innerHTML =
        `<div style="color: var(--text-muted); font-weight: 500;">${TRANSLATIONS[lang].quizEmpty}</div>`;
    } else {
      activeIndex = Math.max(0, activeIndex - 1);
      renderTopBar();
      selectWord(activeIndex);
    }

    proposePreFetch();
  }
}

function openAddLessonModal() {
  const modal = document.getElementById('addLessonModal');
  if (modal) {
    document.getElementById('addLessonTitle').value = '';
    document.getElementById('addLessonTranslation').value = '';
    document.getElementById('addLessonWords').value = '';

    // Auto-calculate the next sequential lesson number
    const select = document.getElementById('lessonSelect');
    let maxNum = 0;
    for (let i = 1; i < select.options.length; i++) {
      const val = parseInt(select.options[i].value);
      if (!isNaN(val) && val > maxNum) {
        maxNum = val;
      }
    }
    document.getElementById('addLessonNumber').value = maxNum + 1;

    modal.classList.add('active');
  }
}

function closeAddLessonModal() {
  const modal = document.getElementById('addLessonModal');
  if (modal) modal.classList.remove('active');
}

function addLessonSubmit() {
  const numInput = document.getElementById('addLessonNumber');
  const titleInput = document.getElementById('addLessonTitle');
  const transInput = document.getElementById('addLessonTranslation');
  const wordsInput = document.getElementById('addLessonWords');

  const lessonNum = numInput ? parseInt(numInput.value) : 0;
  const title = titleInput ? titleInput.value.trim() : '';
  const translation = transInput ? transInput.value.trim() : '';
  const wordsStr = wordsInput ? wordsInput.value : '';
  const lang = appSettings.lang || 'vi';

  if (isNaN(lessonNum) || lessonNum <= 0) {
    alert(TRANSLATIONS[lang].addLessonNumberAlert);
    return;
  }
  if (!title || !translation) {
    alert(TRANSLATIONS[lang].addLessonFieldsAlert);
    return;
  }

  // Load existing custom lessons
  const customLessons = JSON.parse(localStorage.getItem('custom_lessons') || '[]');

  // Check duplicate
  if (customLessons.some(cl => cl.lesson === lessonNum)) {
    alert(TRANSLATIONS[lang].addLessonSuccess.replace('{num}', lessonNum));
    return;
  }

  // Parse comma-separated words (handles English, Vietnamese, and Chinese commas, newlines)
  const rawWords = wordsStr.split(/[,\n，\r]+/).map(w => w.trim()).filter(w => w.length > 0);
  
  // Map words to the standardized online-only vocab format
  const vocabList = rawWords.map(word => {
    const item = {
      lesson: lessonNum,
      hanzi: word
    };
    if (window.pinyinPro) {
      item.pinyin = window.pinyinPro.pinyin(word);
    }
    return item;
  });

  // 1. Save lesson metadata
  customLessons.push({ lesson: lessonNum, title, translation });
  customLessons.sort((a, b) => a.lesson - b.lesson);
  localStorage.setItem('custom_lessons', JSON.stringify(customLessons));

  // 2. Save vocabulary list to custom localStorage
  localStorage.setItem(`custom_vocab_lesson_${lessonNum}`, JSON.stringify(vocabList));

  closeAddLessonModal();

  // 3. Auto-download the perfect clean JSON file for the user to save in lessons/ folder
  const exportData = {
    lesson: lessonNum,
    title: title,
    translation: translation,
    vocab: rawWords.map(word => ({ hanzi: word }))
  };

  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `lesson_${lessonNum}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  // Reload dropdown and select the newly added lesson
  discoverLessons().then(() => {
    document.getElementById('lessonSelect').value = lessonNum;
    loadAndRenderData();
  });
}

function exportCurrentLesson() {
  const selected = document.getElementById('lessonSelect').value;
  const lang = appSettings.lang || 'vi';
  if (selected === 'all') {
    alert(TRANSLATIONS[lang].exportSelectAlert);
    return;
  }

  const num = parseInt(selected);
  const selectElement = document.getElementById('lessonSelect');
  const optionText = selectElement.selectedOptions[0].textContent;

  let title = '';
  let translation = '';
  const match = optionText.match(/Bài \d+:\s*(.*?)\s*\((.*?)\)/);
  if (match) {
    title = match[1];
    translation = match[2];
  }

  // Map only "hanzi" properties for the online-only standardized format
  const cleanVocab = currentVocabList.map(item => ({ hanzi: item.hanzi }));

  const exportData = {
    lesson: num,
    title: title,
    translation: translation,
    vocab: cleanVocab
  };

  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `lesson_${num}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* LAZY-LOADING EVENT CONTROLLERS */
function lazyLoadWord(index, event) {
  if (event) event.stopPropagation();
  const item = currentVocabList[index];
  if (!item) return;

  const meaningContainer = document.getElementById('meaningContainer');
  const examplesContainer = document.getElementById('examplesContainer');

  if (meaningContainer) {
    meaningContainer.innerHTML = `<div class="loader" style="width: 20px; height: 20px; border-width: 2px;"></div>`;
  }
  if (examplesContainer) {
    examplesContainer.innerHTML = `<div style="color: var(--text-muted); font-size: 12px;">Đang tải ví dụ...</div>`;
  }

  getOnlineVocabData(item.hanzi).then(data => {
    item.meaning = data.meaning;
    item.examples = data.examples;
    item.type = item.type || data.type;

    // Refresh if the user is still looking at this specific word
    if (activeIndex === index) {
      selectWord(index);
    }
  }).catch(err => {
    if (activeIndex === index && meaningContainer) {
      meaningContainer.innerHTML = `<span class="lazy-load-trigger" style="font-size: 14px; font-weight: normal; color: #ef4444; cursor: pointer;" onclick="lazyLoadWord(${index}, event)">❌ Thử lại: ${err.message}</span>`;
    }
  });
}

function lazyLoadFlashcard(index) {
  const item = fcList[index];
  if (!item) return;

  const container = document.getElementById('fcMeaningContainer');
  if (container) {
    container.innerHTML = `<div class="loader" style="width: 20px; height: 20px; border-width: 2px;"></div>`;
  }

  getOnlineVocabData(item.hanzi).then(data => {
    item.meaning = data.meaning;
    item.examples = data.examples;
    item.type = item.type || data.type;

    if (fcIndex === index && isFlipped) {
      renderFlashcard();
    }
  }).catch(err => {
    if (fcIndex === index && isFlipped && container) {
      container.innerHTML = `❌ Lỗi: Bấm thử lại`;
    }
  });
}

/* INTERNATIONALIZATION (i18n) DICTIONARY & HANDLERS */
const TRANSLATIONS = {
  vi: {
    tabVocab: "Từ vựng",
    tabDialogue: "Hội thoại",
    tabFlashcard: "Ôn tập",
    searchPlaceholder: "🔍 Tìm kiếm...",
    lessonAll: "📚 Tất cả bài",
    emptyCard: "Chọn một từ để xem cách viết chi tiết",
    swipeHint: "👈 Vuốt / Kéo chuột hoặc dùng phím ◄ ► để chuyển từ 👉",
    editWord: "✏️ Sửa từ",
    deleteWord: "🗑️ Xóa từ",
    examplesBoxTitle: "📌 Ví dụ",
    noExamples: "Chưa có ví dụ",
    emptyExamples: "Đang trống (Bấm tải nghĩa để xem ví dụ)",
    lazyLoadWord: "🔍 Bấm để tải nghĩa & ví dụ...",
    lazyLoadFc: "🔍 Bấm để tải nghĩa...",
    fcModeFc: "Thẻ lật",
    fcModeQuiz: "Chọn Pinyin",
    fcModeMeaning: "Chọn Nghĩa",
    fcModeListen: "Luyện Nghe",
    fcModeWrite: "Ôn viết chữ",
    fcHint: "🔄 LẬT THẺ (PHÍM SPACE)",
    quizQuestionText: "Chọn phiên âm Pinyin đúng:",
    quizEmpty: "Không có từ vựng",
    settingsTitle: "⚙️ Cấu hình ứng dụng",
    settingsVoice: "🔊 Giọng đọc tiếng Trung:",
    settingsSpeed: "⚡ Tốc độ đọc: ",
    settingsStroke: "✏️ Tốc độ viết nét: ",
    settingsClearCache: "🧹 Xóa bộ nhớ đệm (Clear Cache)",
    settingsLanguage: "🌐 Ngôn ngữ ứng dụng:",
    adminAddWord: "➕ Thêm từ",
    adminAddLesson: "📚 Thêm bài học mới",
    adminExport: "📥 Xuất file JSON",
    modalAddWordTitle: "➕ Thêm từ vựng mới",
    modalEditWordTitle: "✏️ Sửa từ vựng",
    modalAddLessonTitle: "📚 Thêm bài học mới",
    modalHanziLabel: "Chữ Hán (Hanzi):",
    modalNewHanziLabel: "Chữ Hán mới (Hanzi):",
    modalLessonNumberLabel: "Số thứ tự bài (Ví dụ: 9):",
    modalLessonTitleLabel: "Tiêu đề chữ Hán (Ví dụ: 谢谢):",
    modalLessonTranslationLabel: "Nghĩa tiếng Việt (Ví dụ: Cảm ơn):",
    modalLessonWordsLabel: "Danh sách từ mới (cách nhau bằng dấu phẩy, ví dụ: 谢谢,再见):",
    btnCreateLesson: "Tạo bài học",
    btnAddWord: "Thêm vào bài",
    btnUpdateWord: "Cập nhật từ",
    btnWriteReset: "🔄 Viết lại",
    btnWriteHint: "💡 Gợi ý",
    proposalHeader: "Đồng bộ dữ liệu học",
    proposalBody: "Phát hiện có từ vựng chưa tải đầy đủ. Bạn muốn đồng bộ toàn bộ ngay bây giờ không?",
    proposalAccept: "Tải ngay",
    proposalDecline: "Để sau",
    cacheSizeLabel: "Dung lượng đệm đang dùng: ",
    clearCacheSuccess: "Đã xóa bộ nhớ đệm thành công!",
    clearCacheConfirm: "Bạn có chắc chắn muốn xóa toàn bộ bộ nhớ đệm của từ vựng? Tất cả nghĩa và ví dụ sẽ được làm mới hoàn toàn.",
    addLessonSuccess: "Bài học số {num} đã tồn tại trong danh sách tự tạo!",
    addWordAlert: "Vui lòng nhập chữ Hán!",
    addWordSelectAlert: "Vui lòng chọn một bài học cụ thể để thêm từ vựng!",
    editWordSelectAlert: "Vui lòng chọn một từ vựng để sửa!",
    deleteWordConfirm: 'Bạn có chắc chắn muốn xóa từ "{word}" khỏi bài học?',
    deleteWordSelectAlert: "Vui lòng chọn từ vựng cần xóa!",
    addLessonNumberAlert: "Vui lòng nhập số thứ tự bài học hợp lệ!",
    addLessonFieldsAlert: "Vui lòng nhập đầy đủ tiêu đề và dịch nghĩa tiếng Việt!",
    exportSelectAlert: "Vui lòng chọn một bài học cụ thể để xuất file JSON!",
    unsyncedPlaceholderTitle: "Từ vựng chưa đồng bộ",
    unsyncedPlaceholderDesc: "Phiên âm Pinyin đã sẵn sàng. Bạn có muốn đồng bộ bài học để hiển thị đầy đủ nghĩa và ví dụ tiếng Việt của toàn bộ từ vựng không?",
    unsyncedPlaceholderBtn: "⚡ Đồng bộ bài học",
    fcUnsyncedDesc: "Mặt sau thẻ cần dữ liệu tiếng Việt trực tuyến. Hãy đồng bộ toàn bộ từ vựng để bắt đầu ôn luyện.",
    fcUnsyncedBtn: "⚡ Đồng bộ ngay"
  },
  en: {
    tabVocab: "Vocabulary",
    tabDialogue: "Dialogues",
    tabFlashcard: "Practice",
    searchPlaceholder: "🔍 Search...",
    lessonAll: "📚 All lessons",
    emptyCard: "Select a word to view detailed stroke animations",
    swipeHint: "👈 Swipe / Drag or use keys ◄ ► to navigate 👉",
    editWord: "✏️ Edit Word",
    deleteWord: "🗑️ Delete Word",
    examplesBoxTitle: "📌 Examples",
    noExamples: "No examples available",
    emptyExamples: "Empty (Click load meaning to view examples)",
    lazyLoadWord: "🔍 Click to load meaning & examples...",
    lazyLoadFc: "🔍 Click to load meaning...",
    fcModeFc: "🎴 Flashcard",
    fcModeQuiz: "📝 Pinyin Quiz",
    fcModeMeaning: "📝 Meaning Quiz",
    fcModeListen: "🎧 Listening Quiz",
    fcModeWrite: "✍️ Hanzi Quiz",
    fcHint: "🔄 FLIP CARD (SPACEBAR)",
    quizQuestionText: "Choose the correct Pinyin:",
    quizEmpty: "No vocabulary found",
    settingsTitle: "⚙️ Application Settings",
    settingsVoice: "🔊 Chinese Voice:",
    settingsSpeed: "⚡ Reading Speed: ",
    settingsStroke: "✏️ Stroke Animation: ",
    settingsClearCache: "🧹 Clear Cache",
    settingsLanguage: "🌐 App Language:",
    adminAddWord: "➕ Add Word",
    adminAddLesson: "📚 Add New Lesson",
    adminExport: "📥 Export JSON",
    modalAddWordTitle: "➕ Add New Vocabulary Word",
    modalEditWordTitle: "✏️ Edit Vocabulary Word",
    modalAddLessonTitle: "📚 Add New Lesson",
    modalHanziLabel: "Chinese Character (Hanzi):",
    modalNewHanziLabel: "New Chinese Character (Hanzi):",
    modalLessonNumberLabel: "Lesson Number (e.g., 9):",
    modalLessonTitleLabel: "Chinese Title (e.g., 谢谢):",
    modalLessonTranslationLabel: "Translation of lesson (e.g., Thank you):",
    modalLessonWordsLabel: "New words list (comma-separated, e.g., 谢谢,再见):",
    btnCreateLesson: "Create Lesson",
    btnAddWord: "Add to Lesson",
    btnUpdateWord: "Update Word",
    btnWriteReset: "🔄 Reset",
    btnWriteHint: "💡 Hint",
    proposalHeader: "Sync Study Data",
    proposalBody: "Unsynced vocabulary detected. Do you want to sync all now?",
    proposalAccept: "Sync Now",
    proposalDecline: "Later",
    cacheSizeLabel: "Cache storage used: ",
    clearCacheSuccess: "Cache cleared successfully!",
    clearCacheConfirm: "Are you sure you want to clear all vocabulary cache? All meanings and examples will be refreshed from online.",
    addLessonSuccess: "Lesson number {num} already exists in your custom lessons!",
    addWordAlert: "Please enter Chinese characters!",
    addWordSelectAlert: "Please select a specific lesson to add vocabulary!",
    editWordSelectAlert: "Please select a vocabulary word to edit!",
    deleteWordConfirm: 'Are you sure you want to delete the word "{word}" from this lesson?',
    deleteWordSelectAlert: "Please select a vocabulary word to delete!",
    addLessonNumberAlert: "Please enter a valid lesson number!",
    addLessonFieldsAlert: "Please fill in all title and translation fields!",
    exportSelectAlert: "Please select a specific lesson to export to JSON!",
    unsyncedPlaceholderTitle: "Vocabulary Not Synced",
    unsyncedPlaceholderDesc: "Pinyin transcription is ready. Do you want to sync this lesson to display translations and examples of all words?",
    unsyncedPlaceholderBtn: "⚡ Sync Lesson",
    fcUnsyncedDesc: "The back of the card requires online data. Please sync all vocabulary to start practicing.",
    fcUnsyncedBtn: "⚡ Sync Now"
  }
};

function applyLanguage() {
  const lang = appSettings.lang || 'vi';
  const t = TRANSLATIONS[lang];

  // Update tabs (look inside the button for .tab-label)
  const tabVocab = document.getElementById('tab-vocab');
  if (tabVocab) {
    const label = tabVocab.querySelector('.tab-label');
    if (label) label.textContent = t.tabVocab;
  }

  const tabFlashcard = document.getElementById('tab-flashcard');
  if (tabFlashcard) {
    const label = tabFlashcard.querySelector('.tab-label');
    if (label) label.textContent = t.tabFlashcard;
  }

  const tabDialogue = document.getElementById('tab-dialogue');
  if (tabDialogue) {
    const label = tabDialogue.querySelector('.tab-label');
    if (label) label.textContent = t.tabDialogue;
  }

  // Update theme and settings labels
  const themeLabel = document.getElementById('themeLabel');
  if (themeLabel) themeLabel.textContent = lang === 'en' ? 'Theme' : 'Giao diện';
  
  const settingsLabel = document.getElementById('settingsLabel');
  if (settingsLabel) settingsLabel.textContent = lang === 'en' ? 'Settings' : 'Cài đặt';

  // Update search input placeholder
  const searchInput = document.getElementById('searchInput');
  if (searchInput) searchInput.placeholder = t.searchPlaceholder;

  // Update lessonSelect "all" option
  const lessonSelect = document.getElementById('lessonSelect');
  if (lessonSelect && lessonSelect.options.length > 0) {
    lessonSelect.options[0].textContent = t.lessonAll;
    if (lessonSelect.options.length > 1) {
      lessonSelect.options[1].textContent = lang === 'en' ? "⭐ Starred Words" : "⭐ Đã lưu";
    }
  }

  // Update Admin Bar buttons
  const adminAddWord = document.getElementById('adminAddWordBtn');
  if (adminAddWord) adminAddWord.textContent = t.adminAddWord;

  const adminAddLesson = document.getElementById('adminAddLessonBtn');
  if (adminAddLesson) adminAddLesson.textContent = t.adminAddLesson;

  const adminExport = document.getElementById('adminExportBtn');
  if (adminExport) adminExport.textContent = t.adminExport;

  // Update Settings Modal Labels
  const settingsTitleText = document.getElementById('settingsTitleText');
  if (settingsTitleText) settingsTitleText.textContent = t.settingsTitle;

  const settingsLanguageLabel = document.getElementById('settingsLanguageLabel');
  if (settingsLanguageLabel) settingsLanguageLabel.textContent = t.settingsLanguage;

  const settingsVoiceLabel = document.getElementById('settingsVoiceLabel');
  if (settingsVoiceLabel) settingsVoiceLabel.textContent = t.settingsVoice;

  const settingsSpeedLabel = document.getElementById('settingsSpeedLabel');
  if (settingsSpeedLabel) {
    settingsSpeedLabel.innerHTML = `${t.settingsSpeed}<span id="speedVal">${appSettings.speechSpeed.toFixed(1)}</span>x`;
  }

  const settingsStrokeLabel = document.getElementById('settingsStrokeLabel');
  if (settingsStrokeLabel) {
    settingsStrokeLabel.innerHTML = `${t.settingsStroke}<span id="strokeSpeedVal">${appSettings.strokeSpeed.toFixed(1)}</span>x`;
  }

  const settingsClearCacheBtn = document.getElementById('settingsClearCacheBtn');
  if (settingsClearCacheBtn) settingsClearCacheBtn.textContent = t.settingsClearCache;

  // Update Add Word Modal Labels
  const modalAddWordTitle = document.getElementById('modalAddWordTitle');
  if (modalAddWordTitle) modalAddWordTitle.textContent = t.modalAddWordTitle;

  const modalHanziLabel = document.getElementById('modalHanziLabel');
  if (modalHanziLabel) modalHanziLabel.textContent = t.modalHanziLabel;

  const btnAddWord = document.getElementById('btnAddWord');
  if (btnAddWord) btnAddWord.textContent = t.btnAddWord;

  // Update Edit Word Modal Labels
  const modalEditWordTitle = document.getElementById('modalEditWordTitle');
  if (modalEditWordTitle) modalEditWordTitle.textContent = t.modalEditWordTitle;

  const modalNewHanziLabel = document.getElementById('modalNewHanziLabel');
  if (modalNewHanziLabel) modalNewHanziLabel.textContent = t.modalNewHanziLabel;

  const btnUpdateWord = document.getElementById('btnUpdateWord');
  if (btnUpdateWord) btnUpdateWord.textContent = t.btnUpdateWord;

  // Update Add Lesson Modal Labels
  const modalAddLessonTitle = document.getElementById('modalAddLessonTitle');
  if (modalAddLessonTitle) modalAddLessonTitle.textContent = t.modalAddLessonTitle;

  const modalLessonNumberLabel = document.getElementById('modalLessonNumberLabel');
  if (modalLessonNumberLabel) modalLessonNumberLabel.textContent = t.modalLessonNumberLabel;

  const modalLessonTitleLabel = document.getElementById('modalLessonTitleLabel');
  if (modalLessonTitleLabel) modalLessonTitleLabel.textContent = t.modalLessonTitleLabel;

  const modalLessonTranslationLabel = document.getElementById('modalLessonTranslationLabel');
  if (modalLessonTranslationLabel) modalLessonTranslationLabel.textContent = t.modalLessonTranslationLabel;

  const modalLessonWordsLabel = document.getElementById('modalLessonWordsLabel');
  if (modalLessonWordsLabel) modalLessonWordsLabel.textContent = t.modalLessonWordsLabel;

  const btnCreateLesson = document.getElementById('btnCreateLesson');
  if (btnCreateLesson) btnCreateLesson.textContent = t.btnCreateLesson;

  // Update Sync Proposal Toast labels
  const proposalHeader = document.getElementById('proposalHeader');
  if (proposalHeader) proposalHeader.textContent = t.proposalHeader;

  const acceptBtn = document.querySelector('.proposal-actions .fc-btn-primary');
  if (acceptBtn) acceptBtn.textContent = t.proposalAccept;

  const declineBtn = document.querySelector('.proposal-actions .fc-btn:not(.fc-btn-primary)');
  if (declineBtn) declineBtn.textContent = t.proposalDecline;

  // Re-render current active screen to propagate languages
  if (activeIndex !== -1) {
    selectWord(activeIndex);
  } else {
    const card = document.getElementById('detailCard');
    if (card && card.innerHTML.includes('style="color: var(--text-muted); font-weight: 500;"')) {
      card.innerHTML = `<div style="color: var(--text-muted); font-weight: 500;">${t.emptyCard}</div>`;
    }
  }

  // Update Flashcard Mode Buttons
  const btnModeFc = document.getElementById('btn-mode-fc');
  if (btnModeFc) {
    const label = btnModeFc.querySelector('.tab-label');
    if (label) label.textContent = t.fcModeFc;
  }

  const btnModeQuiz = document.getElementById('btn-mode-quiz');
  if (btnModeQuiz) {
    const label = btnModeQuiz.querySelector('.tab-label');
    if (label) label.textContent = t.fcModeQuiz;
  }

  const btnModeMeaning = document.getElementById('btn-mode-meaning');
  if (btnModeMeaning) {
    const label = btnModeMeaning.querySelector('.tab-label');
    if (label) label.textContent = t.fcModeMeaning;
  }

  const btnModeListen = document.getElementById('btn-mode-listen');
  if (btnModeListen) {
    const label = btnModeListen.querySelector('.tab-label');
    if (label) label.textContent = t.fcModeListen;
  }

  const btnModeWrite = document.getElementById('btn-mode-write');
  if (btnModeWrite) {
    const label = btnModeWrite.querySelector('.tab-label');
    if (label) label.textContent = t.fcModeWrite;
  }

  const quizQuestionText = document.getElementById('quizQuestionText');
  if (quizQuestionText) quizQuestionText.textContent = t.quizQuestionText;

  const btnWriteReset = document.getElementById('btnWriteReset');
  if (btnWriteReset) btnWriteReset.textContent = t.btnWriteReset;

  const btnWriteHint = document.getElementById('btnWriteHint');
  if (btnWriteHint) btnWriteHint.textContent = t.btnWriteHint;

  if (currentView === 'flashcard') {
    renderFlashcard();
  }
  
  updateCacheSizeDisplay();
}

/* HANZI WRITING QUIZ EVENT CONTROLLERS */
/* HANZI WRITING QUIZ EVENT CONTROLLERS */
function setWriteSubMode(submode) {
  writeSubMode = submode;
  document.querySelectorAll('.write-panel .fc-mode-btn').forEach(btn => btn.classList.remove('active'));

  if (submode === 'guided') {
    document.getElementById('btn-write-guided').classList.add('active');
    document.getElementById('guidedControls').style.display = 'flex';
    document.getElementById('freeControls').style.display = 'none';
  } else {
    document.getElementById('btn-write-free').classList.add('active');
    document.getElementById('guidedControls').style.display = 'none';
    document.getElementById('freeControls').style.display = 'flex';
  }

  isDrawingFree = false;
  if (activeWriterQuiz) {
    try {
      activeWriterQuiz.cancelQuiz();
      document.getElementById('quizCanvasTarget').innerHTML = '';
      activeWriterQuiz = null;
    } catch (e) {}
  }
  renderWriteQuiz();
}

function renderWriteQuiz() {
  const item = srsQueue[fcIndex];
  const pinyinLabel = document.getElementById('writePinyin');
  const meaningLabel = document.getElementById('writeMeaning');
  const progressText = document.getElementById('writeProgressText');
  const feedback = document.getElementById('writeFeedback');
  const container = document.getElementById('writeCanvasContainer');

  if (!item) return;

  if (pinyinLabel) pinyinLabel.textContent = item.pinyin || '';
  if (meaningLabel) {
    const lang = appSettings.lang || 'vi';
    meaningLabel.textContent = (item.meaning && item.meaning !== 'Đang dịch...' && item.meaning !== 'Từ vựng')
      ? item.meaning 
      : (lang === 'vi' ? 'Chưa đồng bộ (Ấn "Đồng bộ ngay" ở tab Từ vựng)' : 'Not synced (Sync at Vocabulary tab)');
  }

  container.innerHTML = '';
  if (feedback) feedback.innerHTML = '';

  const chars = item.hanzi.split('');
  const zhChars = chars.filter(c => /[\u4e00-\u9fa5]/.test(c));

  if (zhChars.length === 0) {
    if (feedback) feedback.innerHTML = `<span style="color: var(--text-secondary);">Không có nét viết</span>`;
    return;
  }

  if (currentQuizCharIndex >= zhChars.length) {
    currentQuizCharIndex = 0;
  }

  const lang = appSettings.lang || 'vi';
  const labelPrefix = lang === 'vi' ? 'Viết chữ' : 'Write char';
  if (progressText) {
    progressText.textContent = `${labelPrefix}: ${currentQuizCharIndex + 1} / ${zhChars.length}`;
  }

  const activeChar = zhChars[currentQuizCharIndex];

  // Guided Mode
  if (writeSubMode === 'guided') {
    const wrapper = document.createElement('div');
    wrapper.className = 'writer-box';
    wrapper.style.width = '200px';
    wrapper.style.height = '200px';
    wrapper.innerHTML = `
      <svg class="grid" viewBox="0 0 100 100" style="position: absolute; width: 200px; height: 200px;">
        <line x1="0" y1="50" x2="100" y2="50" stroke="var(--grid-line)" stroke-dasharray="2,2" stroke-width="0.8"/>
        <line x1="50" y1="0" x2="50" y2="100" stroke="var(--grid-line)" stroke-dasharray="2,2" stroke-width="0.8"/>
        <line x1="0" y1="0" x2="100" y2="100" stroke="var(--grid-line)" stroke-dasharray="2,2" stroke-width="0.8"/>
        <line x1="100" y1="0" x2="0" y2="100" stroke="var(--grid-line)" stroke-dasharray="2,2" stroke-width="0.8"/>
      </svg>
      <div id="quizCanvasTarget" style="position: absolute; width: 200px; height: 200px;"></div>
    `;
    container.appendChild(wrapper);

    const isDark = document.documentElement.classList.contains('dark');
    activeWriterQuiz = HanziWriter.create('quizCanvasTarget', activeChar, {
      width: 200,
      height: 200,
      padding: 6,
      showCharacter: false,
      showOutline: true,
      strokeColor: isDark ? '#6366f1' : '#4f46e5',
      outlineColor: isDark ? '#334155' : '#e2e8f0',
      strokeAnimationSpeed: appSettings.strokeSpeed,
      delayBetweenStrokes: 25,
      highlightColor: '#10b981'
    });

    activeWriterQuiz.quiz({
      onComplete: (summary) => {
        if (feedback) {
          feedback.innerHTML = `<span style="color: #10b981; font-weight: 700;">✓ ${activeChar}</span>`;
        }
        speakZh(activeChar);
        
        setTimeout(() => {
          if (fcMode !== 'write' || writeSubMode !== 'guided') return;
          
          if (currentQuizCharIndex < zhChars.length - 1) {
            currentQuizCharIndex++;
            renderWriteQuiz();
          } else {
            if (feedback) {
              const congrats = lang === 'vi' ? '🎉 Hoàn thành xuất sắc!' : '🎉 Excellent!';
              feedback.innerHTML = `<span style="color: #10b981; font-weight: 700; font-size: 16px;">${congrats}</span>`;
            }
            speakZh(item.hanzi);

            setTimeout(() => {
              if (fcMode === 'write' && writeSubMode === 'guided') {
                currentQuizCharIndex = 0;
                nextFlashcard();
              }
            }, 1500);
          }
        }, 1000);
      }
    });
  } else {
    // Free Mode
    initFreeWriteCanvas();
  }
}

function resetWriteQuiz() {
  if (activeWriterQuiz) {
    try {
      activeWriterQuiz.cancelQuiz();
    } catch (e) {}
  }
  renderWriteQuiz();
}

function showWriteHint() {
  if (activeWriterQuiz) {
    try {
      activeWriterQuiz.animateCharacter();
    } catch (e) {}
  }
}

/* FREE WRITE HANDLERS */
function initFreeWriteCanvas() {
  const container = document.getElementById('writeCanvasContainer');
  if (!container) return;

  container.innerHTML = '';
  
  const item = srsQueue[fcIndex];
  if (!item) return;

  const chars = item.hanzi.split('');
  const zhChars = chars.filter(c => /[\u4e00-\u9fa5]/.test(c));
  if (zhChars.length === 0) return;
  const activeChar = zhChars[currentQuizCharIndex];

  const wrapper = document.createElement('div');
  wrapper.style.position = 'relative';
  wrapper.style.width = '200px';
  wrapper.style.height = '200px';
  wrapper.className = 'writer-box';

  wrapper.innerHTML = `
    <svg class="grid" viewBox="0 0 100 100" style="position: absolute; width: 200px; height: 200px; z-index: 1; pointer-events: none;">
      <line x1="0" y1="50" x2="100" y2="50" stroke="var(--grid-line)" stroke-dasharray="2,2" stroke-width="0.8"/>
      <line x1="50" y1="0" x2="50" y2="100" stroke="var(--grid-line)" stroke-dasharray="2,2" stroke-width="0.8"/>
      <line x1="0" y1="0" x2="100" y2="100" stroke="var(--grid-line)" stroke-dasharray="2,2" stroke-width="0.8"/>
      <line x1="100" y1="0" x2="0" y2="100" stroke="var(--grid-line)" stroke-dasharray="2,2" stroke-width="0.8"/>
    </svg>
    <div id="freeWriteAnimTarget" style="position: absolute; width: 200px; height: 200px; z-index: 2; pointer-events: none;"></div>
    <canvas id="freeWriteCanvas" width="200" height="200" style="position: absolute; width: 200px; height: 200px; z-index: 3; cursor: crosshair; background: transparent;"></canvas>
  `;
  container.appendChild(wrapper);

  const isDark = document.documentElement.classList.contains('dark');
  freeWriterAnimate = HanziWriter.create('freeWriteAnimTarget', activeChar, {
    width: 200,
    height: 200,
    padding: 6,
    showCharacter: false,
    showOutline: false,
    strokeColor: '#3b82f6', // Indigo/Blue stroke comparison
    strokeAnimationSpeed: appSettings.strokeSpeed,
    delayBetweenStrokes: 100
  });

  freeCanvas = document.getElementById('freeWriteCanvas');
  if (!freeCanvas) return;
  freeCtx = freeCanvas.getContext('2d');

  freeCtx.strokeStyle = isDark ? '#ffffff' : '#1e293b';
  freeCtx.lineWidth = 4;
  freeCtx.lineCap = 'round';
  freeCtx.lineJoin = 'round';

  function getCoordinates(e) {
    const rect = freeCanvas.getBoundingClientRect();
    let clientX, clientY;

    if (e.touches && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    return {
      x: (clientX - rect.left) * (freeCanvas.width / rect.width),
      y: (clientY - rect.top) * (freeCanvas.height / rect.height)
    };
  }

  function startDraw(e) {
    e.preventDefault();
    isDrawingFree = true;
    const coords = getCoordinates(e);
    lastFreeX = coords.x;
    lastFreeY = coords.y;

    freeCtx.beginPath();
    freeCtx.arc(lastFreeX, lastFreeY, freeCtx.lineWidth / 2, 0, Math.PI * 2);
    freeCtx.fillStyle = freeCtx.strokeStyle;
    freeCtx.fill();
  }

  function draw(e) {
    if (!isDrawingFree) return;
    e.preventDefault();
    const coords = getCoordinates(e);

    freeCtx.beginPath();
    freeCtx.moveTo(lastFreeX, lastFreeY);
    freeCtx.lineTo(coords.x, coords.y);
    freeCtx.stroke();

    lastFreeX = coords.x;
    lastFreeY = coords.y;
  }

  function stopDraw(e) {
    isDrawingFree = false;
  }

  freeCanvas.addEventListener('mousedown', startDraw);
  freeCanvas.addEventListener('mousemove', draw);
  freeCanvas.addEventListener('mouseup', stopDraw);
  freeCanvas.addEventListener('mouseleave', stopDraw);

  freeCanvas.addEventListener('touchstart', startDraw, { passive: false });
  freeCanvas.addEventListener('touchmove', draw, { passive: false });
  freeCanvas.addEventListener('touchend', stopDraw);
}

function clearFreeWriteCanvas() {
  if (freeCtx && freeCanvas) {
    freeCtx.clearRect(0, 0, freeCanvas.width, freeCanvas.height);
  }
  if (freeWriterAnimate) {
    freeWriterAnimate.hideCharacter();
  }
  const feedback = document.getElementById('writeFeedback');
  if (feedback) feedback.innerHTML = '';
}

function gradeFreeWriteCanvas(activeChar) {
  // 1. Render the ideal correct character on an offscreen canvas
  const offscreen = document.createElement('canvas');
  offscreen.width = 200;
  offscreen.height = 200;
  const oCtx = offscreen.getContext('2d');

  oCtx.fillStyle = '#000000';
  oCtx.font = 'bold 150px "Noto Sans SC", "Noto Sans", "Microsoft YaHei", sans-serif';
  oCtx.textAlign = 'center';
  oCtx.textBaseline = 'middle';
  oCtx.fillText(activeChar, 100, 100);

  const idealData = oCtx.getImageData(0, 0, 200, 200).data;

  // 2. Get the user's drawn pixels
  if (!freeCanvas) return 0;
  const userData = freeCtx.getImageData(0, 0, 200, 200).data;

  let idealCount = 0;
  let matchCount = 0;
  let overdrawCount = 0;

  for (let i = 0; i < idealData.length; i += 4) {
    const idealAlpha = idealData[i + 3];
    const userAlpha = userData[i + 3];

    const isIdealFilled = idealAlpha > 10;
    const isUserFilled = userAlpha > 10;

    if (isIdealFilled) {
      idealCount++;
      if (isUserFilled) {
        matchCount++;
      }
    } else if (isUserFilled) {
      overdrawCount++;
    }
  }

  if (idealCount === 0) return 0;

  const matchRatio = matchCount / idealCount;
  const overdrawRatio = overdrawCount / idealCount;
  // Apply a polite penalty for drawing outside of boundaries
  const penalty = overdrawRatio * 0.35;

  const finalScore = Math.max(0, Math.min(100, Math.round((matchRatio - penalty) * 100)));
  return finalScore;
}

function checkFreeWriteCanvas() {
  const feedback = document.getElementById('writeFeedback');
  const lang = appSettings.lang || 'vi';

  if (feedback) {
    feedback.innerHTML = `<span style="color: var(--accent); font-weight: 700;">${lang === 'vi' ? '👁️ Đang chấm điểm...' : '👁️ Grading...'}</span>`;
  }

  const item = srsQueue[fcIndex];
  const chars = item.hanzi.split('');
  const zhChars = chars.filter(c => /[\u4e00-\u9fa5]/.test(c));
  const activeChar = zhChars[currentQuizCharIndex];

  // Grade the user's drawing!
  const score = gradeFreeWriteCanvas(activeChar);

  if (freeWriterAnimate) {
    freeWriterAnimate.showOutline();
    freeWriterAnimate.animateCharacter({
      onComplete: () => {
        if (feedback) {
          const isPassed = score >= 50;
          if (isPassed) {
            feedback.innerHTML = `<span style="color: #10b981; font-weight: 700; font-size: 15px;">🎉 ${lang === 'vi' ? 'Chính xác!' : 'Correct!'} (${score}%)</span>`;
            speakZh(activeChar);

            // Auto-advance
            setTimeout(() => {
              if (fcMode !== 'write' || writeSubMode !== 'free') return;

              if (currentQuizCharIndex < zhChars.length - 1) {
                currentQuizCharIndex++;
                renderWriteQuiz();
              } else {
                feedback.innerHTML = `<span style="color: #10b981; font-weight: 700; font-size: 16px;">🎉 ${lang === 'vi' ? 'Đã hoàn thành từ này!' : 'Word completed!'} (${score}%)</span>`;
                speakZh(item.hanzi);
                setTimeout(() => {
                  if (fcMode === 'write' && writeSubMode === 'free') {
                    currentQuizCharIndex = 0;
                    nextFlashcard();
                  }
                }, 1500);
              }
            }, 1800);
          } else {
            feedback.innerHTML = `
              <div style="display:flex; flex-direction:column; gap:6px; align-items:center;">
                <span style="color: #ef4444; font-weight: 700; font-size: 14px;">❌ ${lang === 'vi' ? 'Chưa chính xác!' : 'Incorrect!'} (${score}%)</span>
                <span style="color: var(--text-secondary); font-size: 12px; max-width:280px; line-height:1.4;">${lang === 'vi' ? 'Hãy so nét màu xanh dương đằng sau và click Viết lại để vẽ lại.' : 'Compare with the blue stroke order behind and click Clear to try again.'}</span>
              </div>
            `;
          }
        }
      }
    });
  }
}

async function loadAndRenderDialogues() {
  const selected = document.getElementById('lessonSelect').value;
  const container = document.getElementById('dialogueListContainer');
  if (!container) return;

  if (selected === 'all' || selected === 'starred') {
    container.innerHTML = `
      <div style="text-align: center; padding: 40px; color: var(--text-muted); font-weight: 500;">
        <span style="font-size: 48px;">💬</span>
        <p style="margin-top: 16px;">Vui lòng chọn một bài học cụ thể (ví dụ: Bài 1, Bài 2...) để học Hội thoại giao tiếp.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `<div style="text-align: center; padding: 40px;"><div class="loader" style="width:30px; height:30px; border-top-color: var(--accent); margin:0 auto 16px auto;"></div><div>Đang tải hội thoại...</div></div>`;

  const lessonNum = parseInt(selected);
  const lessonData = await fetchLessonData(lessonNum);
  
  let sentences = [];
  if (lessonData && Array.isArray(lessonData.sentences)) {
    sentences = lessonData.sentences;
  } else {
    // Dynamically compile sentences from vocabulary examples!
    const compiled = [];
    currentVocabList.forEach(item => {
      if (Array.isArray(item.examples)) {
        item.examples.forEach(ex => {
          if (ex && ex.zh && !compiled.some(c => c.zh === ex.zh)) {
            compiled.push(ex);
          }
        });
      }
    });

    // Prioritize questions (sentences with question marks or question words)
    const questionWords = ['吗', '呢', 'muốn', 'không', 'nào', 'gì', 'gì?', 'gì ？', 'không?', '吗', '呢', '什么', '谁', '几', '哪', '怎么', '多少', '？', '?'];
    compiled.sort((a, b) => {
      const aIsQ = questionWords.some(w => a.zh.includes(w));
      const bIsQ = questionWords.some(w => b.zh.includes(w));
      if (aIsQ && !bIsQ) return -1;
      if (!aIsQ && bIsQ) return 1;
      return 0;
    });

    sentences = compiled.slice(0, 10); // Take top 10 sentences
  }

  if (sentences.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 40px; color: var(--text-muted); font-weight: 500;">
        <span style="font-size: 48px;">💬</span>
        <p style="margin-top: 16px;">Chưa có dữ liệu hội thoại cho bài học này. Hãy thử tải nghĩa của từ vựng trước để tổng hợp câu ví dụ!</p>
      </div>
    `;
    return;
  }

  const questionWords = ['吗', '呢', '什么', '谁', '几', '哪', '怎么', '多少', '？', '?'];

  container.innerHTML = sentences.map((ex, index) => {
    const isQuestion = questionWords.some(w => ex.zh.includes(w));
    const align = isQuestion ? 'flex-start' : 'flex-end';
    const bg = isQuestion ? 'var(--accent-soft)' : 'var(--bg-card)';
    const border = isQuestion ? '3px solid var(--accent)' : '1px solid var(--border-card)';
    
    return `
      <div class="dialogue-bubble" style="align-self: ${align}; max-width: 85%; width: 100%; display: flex; gap: 12px; background: ${bg}; border-left: ${border}; padding: 14px 18px; border-radius: 16px; box-shadow: var(--shadow-fc); box-sizing: border-box;">
        <button class="audio-btn-lg" onclick="speakZh('${ex.zh}', event)" style="font-size: 16px; padding: 8px; border-radius: 50%; width: 36px; height: 36px; flex-shrink: 0; display:flex; align-items:center; justify-content:center;">🔊</button>
        <div style="flex: 1; text-align: left;">
          <div style="font-size: 18px; font-weight: bold; color: var(--text-primary); font-family: 'Noto Sans SC', sans-serif; line-height:1.3;">${ex.zh}</div>
          <div style="font-size: 13px; color: var(--text-secondary); margin-top: 4px; font-weight: 600;">${ex.pinyin || ''}</div>
          <div style="font-size: 14px; color: var(--text-primary); margin-top: 6px; border-top: 1px solid var(--border-sidebar); padding-top: 4px;">${ex.vi || ''}</div>
        </div>
      </div>
    `;
  }).join('');
}

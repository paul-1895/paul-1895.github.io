/* ================================================================
   chatbot.js - AI Chatbot integration with local storage
   Uses DeepSeek API (OpenAI-compatible format)
   ================================================================ */

'use strict';

class DSEChatbot {
  constructor() {
    this.apiEndpoint = 'http://localhost:11434/v1/chat/completions';
    this.model = 'qwen2.5:14b';
    this.maxTokens = 1024;
    this.chatHistory = [];
    this.storageKey = 'dse-chatbot-history';
    this.contextData = null;
    
    this.loadHistory();
  }

  /* ---- Storage ---- */
  loadHistory() {
    try {
      const saved = localStorage.getItem(this.storageKey);
      this.chatHistory = saved ? JSON.parse(saved) : [];
    } catch (e) {
      console.error('Failed to load chat history:', e);
      this.chatHistory = [];
    }
  }

  saveHistory() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.chatHistory));
    } catch (e) {
      console.error('Failed to save chat history:', e);
    }
  }

  clearHistory() {
    this.chatHistory = [];
    this.saveHistory();
  }

  /* ---- Context ---- */
  setContext(stockData) {
    this.contextData = stockData;
  }

  getSystemPrompt() {
    let prompt = `You are an expert financial advisor for the Dhaka Stock Exchange (DSE). 
You provide concise, helpful responses about stock trading, market analysis, and company information.
Always reference the currency in BDT (Taka) and maintain a professional tone.
Keep responses brief and actionable.`;

    if (this.contextData) {
      const { code, name, ltp, ycp, change, high, low, volume } = this.contextData;
      prompt += `

Current Stock Context:
- Code: ${code}
- Name: ${name}
- Last Traded Price: ৳${ltp}
- Yesterday's Close: ৳${ycp}
- Change: ${change > 0 ? '+' : ''}${change} (${((change/ycp)*100).toFixed(2)}%)
- High: ৳${high} | Low: ৳${low}
- Volume: ${volume.toLocaleString()}

Use this context to provide relevant analysis for ${code}.`;
    }

    return prompt;
  }

  /* ---- API Call ---- */
async sendMessage(userMessage) {
  // Add user message to history
  this.chatHistory.push({
    role: 'user',
    content: userMessage
  });

  let projectContext = '';

  /* --------------------------------------------------
     Detect project file references
     Example:
     "Analyze news/ROBI.json"
  -------------------------------------------------- */
  const fileMatch = userMessage.match(
    /([a-zA-Z0-9_\-/]+\.json)/i
  );

  if (fileMatch) {
    try {
      const filePath = fileMatch[1];

      const contextResponse = await fetch('/api/chat/context', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          filePath
        })
      });

      if (contextResponse.ok) {
        const fileData = await contextResponse.json();

        let formattedContent = fileData.content;

        /* ----------------------------------------------
           Try formatting JSON intelligently
        ---------------------------------------------- */
        try {
          const parsed = JSON.parse(fileData.content);

          // If news/articles structure exists
          if (Array.isArray(parsed)) {
            formattedContent = parsed
              .slice(0, 10)
              .map((item, index) => {
                return `
Article ${index + 1}
Title: ${item.title || 'N/A'}
Summary: ${item.summary || item.description || 'N/A'}
Date: ${item.date || 'N/A'}
Source: ${item.source || 'N/A'}
                `;
              })
              .join('\n');
          }
        } catch (e) {
          // Keep raw content if parsing fails
        }

        /* ----------------------------------------------
           Prevent extremely large prompts
        ---------------------------------------------- */
        if (formattedContent.length > 12000) {
          formattedContent =
            formattedContent.substring(0, 12000) +
            '\n\n[Content truncated due to size]';
        }

        projectContext = `
==================================================
PROJECT FILE CONTEXT
==================================================

File:
${fileData.file}

Content:
${formattedContent}

==================================================
END PROJECT FILE CONTEXT
==================================================
`;
      }
    } catch (err) {
      console.error('Context loading error:', err);
    }
  }

  /* --------------------------------------------------
     Enhanced system prompt
  -------------------------------------------------- */
  const systemPrompt = `
${this.getSystemPrompt()}

You are connected to the DSE Analysis project.

You can analyze:
- Stock market data
- Watchlists
- JSON news files
- Technical indicators
- Historical price movements
- DSE company information

If project file context is provided,
use it to answer accurately.

Do NOT say:
"I cannot access local files"

because the backend already provided the content.

Always provide:
- concise analysis
- financial insights
- actionable observations
- market reasoning
`;

  const messages = [
    {
      role: 'system',
      content: systemPrompt + '\n\n' + projectContext
    },

    ...this.chatHistory.map(msg => ({
      role: msg.role,
      content: msg.content
    }))
  ];

  try {
    const response = await fetch(this.apiEndpoint, {
      method: 'POST',

      headers: {
        'Content-Type': 'application/json'
      },

      body: JSON.stringify({
        model: this.model,
        max_tokens: this.maxTokens,
        temperature: 0.7,
        stream: false,
        messages
      })
    });

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({}));

      throw new Error(
        error.error?.message ||
        `Ollama error: ${response.status}. Is "ollama serve" running?`
      );
    }

    const data = await response.json();

    const assistantMessage =
      data.choices?.[0]?.message?.content ||
      'No response generated.';

    this.chatHistory.push({
      role: 'assistant',
      content: assistantMessage
    });

    this.saveHistory();

    return assistantMessage;

  } catch (err) {

    // Remove failed user message
    this.chatHistory.pop();

    if (err.message.includes('Failed to fetch')) {
      throw new Error(
        'Cannot reach Ollama. Run: ollama serve'
      );
    }

    throw err;
  }
}

  /* ---- Utility ---- */
  getApiKey() { return null; } // No API key needed for local Ollama
}

/* ================================================================
   UI Controller
   ================================================================ */

let chatbot = null;

function initChatbot(stockData = null) {
  chatbot = new DSEChatbot();
  if (stockData) chatbot.setContext(stockData);
  renderChatUI();
  loadChatHistory();
}

function renderChatUI() {
  const chatContainer = document.getElementById('chatbot-container');
  if (!chatContainer) return;

  chatContainer.innerHTML = `
    <div class="chatbot-widget">
      <div class="chatbot-header">
        <h3>DSE Market Assistant</h3>
        <div class="chatbot-controls">
          <button id="chatbot-minimize" title="Minimize" onclick="toggleMinimizeChatbot()">—</button>
          <button id="chatbot-clear" title="Clear history" onclick="clearChatHistory()">🗑️</button>
          <button id="chatbot-close" title="Close" onclick="toggleChatbot()">✕</button>
        </div>
      </div>
      <div class="chatbot-messages" id="chatbot-messages"></div>
      <div class="chatbot-input-area">
        <input
          type="text"
          id="chatbot-input"
          class="chatbot-input"
          placeholder="Ask about stocks, trends, analysis…"
          autocomplete="off"
          onkeydown="if(event.key==='Enter') sendChatMessage()"
        />
        <button class="chatbot-send" onclick="sendChatMessage()" id="chatbot-send">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M16 8l-8 8M21 4l-10 20L3 4l18 0z"/>
          </svg>
        </button>
      </div>
    </div>
  `;
}

function loadChatHistory() {
  const container = document.getElementById('chatbot-messages');
  if (!container || !chatbot) return;

  container.innerHTML = '';
  chatbot.chatHistory.forEach(msg => {
    appendMessage(msg.content, msg.role);
  });
  container.scrollTop = container.scrollHeight;
}

function appendMessage(content, role) {
  const container = document.getElementById('chatbot-messages');
  if (!container) return;

  const msgEl = document.createElement('div');
  msgEl.className = `chatbot-message chatbot-${role}`;
  msgEl.textContent = content;
  container.appendChild(msgEl);
  container.scrollTop = container.scrollHeight;
}

function showTypingIndicator() {
  const container = document.getElementById('chatbot-messages');
  if (!container) return;

  // Prevent duplicates
  if (document.getElementById('chatbot-typing')) return;

  const typingEl = document.createElement('div');

  typingEl.id = 'chatbot-typing';
  typingEl.className = 'chatbot-message chatbot-assistant chatbot-typing';

  typingEl.innerHTML = `
    <div class="typing-dots">
      <span></span>
      <span></span>
      <span></span>
    </div>
  `;

  container.appendChild(typingEl);
  container.scrollTop = container.scrollHeight;
}

function hideTypingIndicator() {
  const typingEl = document.getElementById('chatbot-typing');

  if (typingEl) {
    typingEl.remove();
  }
}

async function sendChatMessage() {
  const input = document.getElementById('chatbot-input');
  const message = input.value.trim();
  if (!message || !chatbot) return;

  input.value = '';
  input.disabled = true;

  appendMessage(message, 'user');

  showTypingIndicator();

  try {
    const response = await chatbot.sendMessage(message);
    hideTypingIndicator();
    appendMessage(response, 'assistant');
  } catch (err) {
    hideTypingIndicator();
    appendMessage(`Error: ${err.message}`, 'assistant');
  } finally {
    input.disabled = false;
    input.focus();
  }
}

function clearChatHistory() {
  if (!chatbot) return;
  if (confirm('Clear all chat history?')) {
    chatbot.clearHistory();
    loadChatHistory();
  }
}

function toggleChatbot() {
  const widget = document.querySelector('.chatbot-widget');
  if (widget) widget.style.display = widget.style.display === 'none' ? 'block' : 'none';
}

function toggleMinimizeChatbot() {
  const container = document.getElementById('chatbot-container');
  const widget = document.querySelector('.chatbot-widget');

  if (!container || !widget) return;

  container.classList.toggle('minimized');
  widget.classList.toggle('minimized');

  const btn = document.getElementById('chatbot-minimize');

  if (widget.classList.contains('minimized')) {
    btn.textContent = '+';
    btn.title = 'Expand';
  } else {
    btn.textContent = '—';
    btn.title = 'Minimize';
  }
}

window.toggleMinimizeChatbot = toggleMinimizeChatbot;
window.toggleChatbot = toggleChatbot;
window.clearChatHistory = clearChatHistory;
window.sendChatMessage = sendChatMessage;
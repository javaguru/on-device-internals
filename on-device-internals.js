const tabBtns = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        tabBtns.forEach(t => t.classList.remove('active'));
        tabContents.forEach(c => c.classList.remove('active'));

        btn.classList.add('active');
        const targetId = btn.getAttribute('data-target');
        document.getElementById(targetId).classList.add('active');
    });
});

const executeBtn = document.getElementById('executeBtn');
const cancelBtn = document.getElementById('cancelBtn');
const promptInput = document.getElementById('promptInput');
const contextInput = document.getElementById('contextInput');
const contextWordCount = document.getElementById('contextWordCount');
const topKInput = document.getElementById('topK');
const temperatureInput = document.getElementById('temperature');
const languageSelect = document.getElementById('languageSelect');
const enableCanvas = document.getElementById('enableCanvas');
const autoReadVoice = document.getElementById('autoReadVoice');
const conversationContainer = document.getElementById('conversationContainer');
const imageInput = document.getElementById('imageInput');
const fileInfo = document.getElementById('fileInfo');

let currentFile = null;
let attachmentType = null;
let aiSession = null;
let abortController = null;

promptInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
        // If Shift, Ctrl, ou Meta (Mac)
        if (e.shiftKey || e.ctrlKey || e.metaKey) {
            // If  Ctrl+Enter / Meta+Enter carriage return
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                const start = this.selectionStart;
                const end = this.selectionEnd;
                this.value = this.value.substring(0, start) + "\n" + this.value.substring(end);
                this.selectionStart = this.selectionEnd = start + 1;
            }
            return;
        }

        e.preventDefault();
        if (!executeBtn.disabled) {
            executeBtn.click();
        }
    }
});

const logsContainer = document.getElementById('eventLogs');
function addLog(msg, isError = false) {
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0] + '.' + String(now.getMilliseconds()).padStart(3, '0');
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.innerHTML = `<span class="log-time">[${timeStr}]</span> <span class="${isError ? 'log-error' : 'log-msg'}">${msg}</span>`;
    logsContainer.appendChild(entry);
    logsContainer.scrollTop = logsContainer.scrollHeight;
}

function getAiApi() {
    try {
        if (typeof LanguageModel !== 'undefined') return LanguageModel;
        if (window.ai && window.ai.languageModel) return window.ai.languageModel;
    } catch (e) {
        console.warn("API not found:", e);
    }
    return null;
}

// Performances device
function getDevicePerformanceClass() {
    const ram = navigator.deviceMemory || 4;
    const cores = navigator.hardwareConcurrency || 4;

    let score = 0;
    if (ram >= 8) score += 2;
    else if (ram >= 4) score += 1;

    if (cores >= 12) score += 2;
    else if (cores >= 8) score += 1;

    if (score >= 4) return "High 🟢 (16GB+ RAM, 12+ Cores)";
    if (score >= 2) return "Medium 🟡 (8GB+ RAM, 8+ Cores)";
    return "Low 🔴 (<8GB RAM, <8 Cores)";
}

// Init & Status
async function initModelStatus() {
    const statusBox = document.getElementById('modelStatusBox');
    addLog("Initializing Model Status check...");
    const aiApi = getAiApi();

    if (!aiApi) {
        const errorMsg = "LanguageModel API not found. Please check Chrome flags.";
        addLog(errorMsg, true);
        statusBox.innerHTML = `<p style="color: #fca5a5;"><strong>Error:</strong> ${errorMsg}</p>`;
        return;
    }

    try {
        const status = await aiApi.availability({ outputLanguage: "en-US" });
        addLog(`Model availability status: ${status}`);

        const perfClass = getDevicePerformanceClass();
        addLog(`Device performance estimated: ${perfClass.split(' ')[0]}`);

        statusBox.innerHTML = `
                    <p><strong>Model Status:</strong> <span style="color: #5eead4;">${status}</span></p>
                    <p><strong>API:</strong> window.ai.languageModel</p>
                    <p><strong>Hardware:</strong> On-Device WebGPU / WASM</p>
                    <p><strong>Performance Class:</strong> ${perfClass}</p>
                `;
    } catch(e) {
        addLog(`Error checking availability: ${e.message}`, true);
        statusBox.innerHTML = `<p style="color: #fca5a5;"><strong>Error:</strong> ${e.message}</p>`;
    }
}
initModelStatus();

contextInput.addEventListener('input', () => {
    const text = contextInput.value.trim();
    const words = text ? text.split(/\s+/).length : 0;
    contextWordCount.textContent = words;
});

imageInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        currentFile = e.target.files[0];
        attachmentType = currentFile.type.startsWith('audio') ? 'audio' : 'image';
        fileInfo.textContent = `Attached: ${currentFile.name}`;
        addLog(`File attached: ${currentFile.name} (${Math.round(currentFile.size/1024)} KB) - Type: ${attachmentType}`);
    }
});

function clearUI() {
    promptInput.value = '';
    if (currentFile) addLog(`File removed: ${currentFile.name}`);
    currentFile = null;
    attachmentType = null;
    imageInput.value = '';
    fileInfo.textContent = '';

    if (window.speechSynthesis && window.speechSynthesis.speaking) {
        window.speechSynthesis.cancel();
    }
}

cancelBtn.addEventListener('click', () => {
    if (abortController) {
        addLog("Sending Abort signal to stop generation...", true);
        abortController.abort();
    }
    if (aiSession) {
        try {
            aiSession.destroy();
            addLog("Session destroyed forcefully to stop generation.");
        } catch(e) {}
    }

    if (window.speechSynthesis && window.speechSynthesis.speaking) {
        window.speechSynthesis.cancel();
    }
});

executeBtn.addEventListener('click', async () => {
    const rawText = promptInput.value.trim();
    const systemContext = contextInput.value.trim();

    if (!rawText && !currentFile) return;

    const aiApi = getAiApi();
    if (!aiApi) {
        alert("The local AI API is not detected on this browser.");
        return;
    }

    executeBtn.disabled = true;
    executeBtn.textContent = 'Executing...';
    cancelBtn.style.display = 'flex';

    abortController = new AbortController();

    try {
        const pairContainer = document.createElement('div');
        pairContainer.className = 'message-pair';

        const userBubble = document.createElement('div');
        userBubble.className = 'bubble bubble-user';
        userBubble.textContent = rawText || "[Media Only]";
        if (currentFile) {
            userBubble.textContent += ` (Attached: ${currentFile.name})`;
        }

        if (systemContext) {
            userBubble.innerHTML += `<br><span style="font-size: 11px; color: var(--btn-active); margin-top: 5px; display: block;">✓ Context applied (${contextWordCount.textContent} words)</span>`;
        }

        const aiBubble = document.createElement('div');
        aiBubble.className = 'bubble bubble-ai';
        aiBubble.innerHTML = '<em>Thinking...</em>';

        pairContainer.appendChild(userBubble);
        pairContainer.appendChild(aiBubble);
        conversationContainer.prepend(pairContainer);

        addLog("Execution started. Building session...");

        if (aiSession) {
            aiSession.destroy();
            addLog("Previous session destroyed to free VRAM.");
        }

        let options = {
            temperature: parseFloat(temperatureInput.value),
            topK: parseInt(topKInput.value),
            signal: abortController.signal
        };

        if (systemContext) {
            options.systemPrompt = systemContext;
            addLog("Context (System Prompt) injected into session options.");
        }

        if (currentFile) {
            options.expectedInputs = [{ type: 'text' }, { type: attachmentType }];
        }

        addLog(`Creating session with Temp: ${options.temperature}, TopK: ${options.topK}`);
        aiSession = await aiApi.create(options);

        const languageName = languageSelect.options[languageSelect.selectedIndex].text.split(' ')[0];

        let textWithSystemInstruction = rawText;
        if (systemContext && typeof options.systemPrompt === 'undefined') {
            textWithSystemInstruction = `[CRITICAL INSTRUCTION: ${systemContext}]\n\nUser request: ${rawText}`;
        }
        textWithSystemInstruction += `\n\n[Instruction for model: You must reply entirely in ${languageName}]`;

        let promptPayload = currentFile
            ? [{ role: 'user', content: [{ type: 'text', value: textWithSystemInstruction }, { type: attachmentType, value: currentFile }] }]
            : textWithSystemInstruction;

        const startTime = performance.now();
        let chunkCount = 0;
        const estimatedInputTokens = Math.ceil(textWithSystemInstruction.length / 4);

        const stream = await aiSession.promptStreaming(promptPayload);
        let fullResponse = '';

        aiBubble.innerHTML = '';

        aiBubble.style.paddingBottom = "45px";
        const ttsBtn = document.createElement('button');
        ttsBtn.className = 'tts-btn';
        ttsBtn.title = 'Read aloud';
        ttsBtn.innerHTML = '🔈';
        let ttsQueued = autoReadVoice.checked;

        if (ttsQueued) {
            ttsBtn.classList.add('playing');
            ttsBtn.innerHTML = '🔊';
        }

        ttsBtn.addEventListener('click', () => {
            if (window.speechSynthesis.speaking && ttsBtn.innerHTML === '🔊') {
                window.speechSynthesis.cancel();
                ttsBtn.classList.remove('playing');
                ttsBtn.innerHTML = '🔈';
                ttsQueued = false;
            } else if (ttsBtn.innerHTML === '🔈') {
                ttsQueued = true;
                ttsBtn.classList.add('playing');
                ttsBtn.innerHTML = '🔊';

                if (executeBtn.disabled === false && fullResponse.length > 0) {
                    playTTS(fullResponse, ttsBtn);
                }
            } else {
                ttsQueued = false;
                ttsBtn.classList.remove('playing');
                ttsBtn.innerHTML = '🔈';
            }
        });

        aiBubble.appendChild(ttsBtn);

        for await (const chunk of stream) {
            if (abortController.signal.aborted) {
                throw new DOMException("Generation aborted by user", "AbortError");
            }

            chunkCount++;
            fullResponse += chunk;

            ttsBtn.remove();

            if (enableCanvas.checked) {
                aiBubble.innerHTML = marked.parse(fullResponse);

                aiBubble.querySelectorAll('pre').forEach((pre) => {
                    const codeBlock = pre.querySelector('code');
                    if (codeBlock) {
                        hljs.highlightElement(codeBlock);

                        const langClass = Array.from(codeBlock.classList).find(c => c.startsWith('language-'));
                        const langName = langClass ? langClass.replace('language-', '') : 'text';

                        const header = document.createElement('div');
                        header.className = 'canvas-header';
                        header.innerHTML = `
                                    <span style="text-transform: uppercase; letter-spacing: 0.5px;">${langName}</span>
                                    <button class="copy-btn" onclick="navigator.clipboard.writeText(this.parentElement.nextElementSibling.innerText); this.textContent='Copied!'; setTimeout(() => this.textContent='Copy', 2000);">Copy</button>
                                `;
                        pre.insertBefore(header, codeBlock);
                    }
                });
            } else {
                aiBubble.textContent = fullResponse;
            }

            aiBubble.appendChild(ttsBtn);
        }

        const endTime = performance.now();
        const durationSec = (endTime - startTime) / 1000;
        const estimatedOutputTokens = Math.ceil(fullResponse.length / 4);
        const tps = (estimatedOutputTokens / durationSec).toFixed(1);

        const metricsDiv = document.createElement('div');
        metricsDiv.style.cssText = "position: absolute; bottom: 15px; right: 55px; font-size: 11px; font-family: Consolas, monospace; opacity: 0.7; white-space: nowrap;";
        metricsDiv.innerHTML = `⏱️ <em style="color: #0059ff;">${durationSec.toFixed(2)}s &nbsp;|&nbsp; 📥 In: ~${estimatedInputTokens} &nbsp;|&nbsp; 📤 Out: ~${estimatedOutputTokens} &nbsp;|&nbsp; 🧩 Chunks: ${chunkCount} &nbsp;|&nbsp; ⚡ ~${tps} TPS</em>`;
        aiBubble.appendChild(metricsDiv);

        addLog(`Execution completed in ${durationSec.toFixed(2)}s (~${tps} TPS). Input: ~${estimatedInputTokens}, Output: ~${estimatedOutputTokens}, Chunks: ${chunkCount}`);
        clearUI();

        if (ttsQueued) {
            playTTS(fullResponse, ttsBtn);
        }

    } catch (error) {
        if (error.name === 'AbortError') {
            addLog("Execution manually aborted.", true);
            if (conversationContainer.firstChild) {
                const aiBubble = conversationContainer.firstChild.querySelector('.bubble-ai');
                if (aiBubble) aiBubble.innerHTML += `<br><br><em style="color: #ff0000;">[Generation stopped by user]</em>`;
            }
        } else {
            console.error("Execution error:", error);
            addLog(`Execution failed: ${error.message}`, true);
            if (conversationContainer.firstChild) {
                const aiBubble = conversationContainer.firstChild.querySelector('.bubble-ai');
                if (aiBubble) aiBubble.innerHTML = `<strong>API Error:</strong> ${error.message}`;
            }
        }
    } finally {
        executeBtn.disabled = false;
        executeBtn.textContent = 'Execute';
        cancelBtn.style.display = 'none';
    }
});

function playTTS(text, btnElement) {
    if (window.speechSynthesis.speaking) {
        window.speechSynthesis.cancel();
    }

    const cleanTextForSpeech = text.replace(/[*_`#]/g, '');
    const utterance = new SpeechSynthesisUtterance(cleanTextForSpeech);

    utterance.lang = languageSelect.value;

    utterance.onstart = () => {
        btnElement.classList.add('playing');
        btnElement.innerHTML = '🔊';
    };

    utterance.onend = () => {
        btnElement.classList.remove('playing');
        btnElement.innerHTML = '🔈';
    };

    utterance.onerror = () => {
        btnElement.classList.remove('playing');
        btnElement.innerHTML = '🔈';
    };

    window.speechSynthesis.speak(utterance);
}

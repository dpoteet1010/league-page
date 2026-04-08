<script>
    import { onMount } from 'svelte';
    import { fly } from 'svelte/transition';

    let query = "";
    let chatHistory = [
        { role: 'assistant', text: "Welcome to the War Room. I have the league history loaded. What's on your mind?" }
    ];
    let isTyping = false;
    let chatContainer;

    // Auto-scroll to bottom when messages change
    const scrollToBottom = async () => {
        if (chatContainer) {
            chatContainer.scrollTop = chatContainer.scrollHeight;
        }
    };

    async function askQuestion() {
        if (!query.trim() || isTyping) return;

        const userMessage = query;
        query = "";
        chatHistory = [...chatHistory, { role: 'user', text: userMessage }];
        isTyping = true;
        
        await scrollToBottom();

        try {
            const response = await fetch('/api/gemini', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt: userMessage })
            });

            const data = await response.json();

            if (data.text) {
                chatHistory = [...chatHistory, { role: 'assistant', text: data.text }];
            } else {
                throw new Error("No response from Commish");
            }
        } catch (err) {
            chatHistory = [...chatHistory, { role: 'assistant', text: "My scouting report is fuzzy. (Error connecting to API)" }];
        } finally {
            isTyping = false;
            await scrollToBottom();
        }
    }
</script>

<div class="chat-wrapper">
    <div class="header">
        <h1>Ask the Commissioner</h1>
        <p>Powered by League History & AI</p>
    </div>

    <div class="chat-container" bind:this={chatContainer}>
        {#each chatHistory as message}
            <div class="message {message.role}" in:fly={{ y: 20, duration: 300 }}>
                <div class="bubble">
                    {message.text}
                </div>
            </div>
        {/each}
        
        {#if isTyping}
            <div class="message assistant">
                <div class="bubble typing">
                    <span class="dot"></span>
                    <span class="dot"></span>
                    <span class="dot"></span>
                </div>
            </div>
        {/if}
    </div>

    <form class="input-area" on:submit|preventDefault={askQuestion}>
        <input 
            type="text" 
            bind:value={query} 
            placeholder="e.g. Who had the best draft in 2024?"
            disabled={isTyping}
        />
        <button type="submit" disabled={isTyping || !query.trim()}>
            {isTyping ? '...' : 'Send'}
        </button>
    </form>
</div>

<style>
    .chat-wrapper {
        max-width: 800px;
        margin: 2rem auto;
        display: flex;
        flex-direction: column;
        height: 80vh;
        background: #1a1a1a;
        border-radius: 12px;
        border: 1px solid #333;
        overflow: hidden;
    }

    .header {
        padding: 1rem;
        background: #222;
        border-bottom: 1px solid #333;
        text-align: center;
    }

    .header h1 { margin: 0; font-size: 1.2rem; color: #fff; }
    .header p { margin: 0; font-size: 0.8rem; color: #888; }

    .chat-container {
        flex: 1;
        padding: 1.5rem;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }

    .message {
        display: flex;
        width: 100%;
    }

    .message.user { justify-content: flex-end; }
    .message.assistant { justify-content: flex-start; }

    .bubble {
        max-width: 80%;
        padding: 0.8rem 1.2rem;
        border-radius: 18px;
        font-size: 0.95rem;
        line-height: 1.4;
    }

    .user .bubble {
        background: #007bff;
        color: white;
        border-bottom-right-radius: 4px;
    }

    .assistant .bubble {
        background: #333;
        color: #eee;
        border-bottom-left-radius: 4px;
    }

    .input-area {
        display: flex;
        padding: 1rem;
        background: #222;
        gap: 0.5rem;
    }

    input {
        flex: 1;
        padding: 0.8rem;
        border-radius: 8px;
        border: 1px solid #444;
        background: #111;
        color: white;
        outline: none;
    }

    input:focus { border-color: #007bff; }

    button {
        padding: 0 1.5rem;
        background: #007bff;
        color: white;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        font-weight: bold;
    }

    button:disabled {
        background: #444;
        cursor: not-allowed;
    }

    /* Typing Animation */
    .typing { display: flex; gap: 4px; padding: 12px 20px; }
    .dot {
        width: 6px;
        height: 6px;
        background: #888;
        border-radius: 50%;
        animation: blink 1.4s infinite both;
    }
    .dot:nth-child(2) { animation-delay: 0.2s; }
    .dot:nth-child(3) { animation-delay: 0.4s; }

    @keyframes blink {
        0%, 80%, 100% { opacity: 0.2; }
        40% { opacity: 1; }
    }
</style>

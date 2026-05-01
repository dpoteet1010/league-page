<script>
    import { tick } from 'svelte';
    import { fly } from 'svelte/transition';
    import { get } from 'svelte/store';
    
    // Import your league data store
    import { leagueData } from '$lib/stores'; 

    let query = "";
    let chatHistory = [
        { role: 'assistant', text: "League Data Test: I'm ready. Ask me about the league settings or name." }
    ];
    let isTyping = false;
    let chatContainer;

    const scrollToBottom = async () => {
        await tick();
        if (chatContainer) chatContainer.scrollTop = chatContainer.scrollHeight;
    };

    async function askQuestion() {
        if (!query.trim() || isTyping) return;

        const userMessage = query;
        query = "";
        chatHistory = [...chatHistory, { role: 'user', text: userMessage }];
        isTyping = true;
        await scrollToBottom();

        // --- TEST: Only sending League Data ---
        const contextData = {
            leagueInfo: get(leagueData) 
        };

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    message: userMessage,
                    history: chatHistory.slice(0, -1),
                    contextData: contextData 
                })
            });

            const data = await response.json();
            if (data.text) {
                chatHistory = [...chatHistory, { role: 'assistant', text: data.text }];
            }
        } catch (err) {
            chatHistory = [...chatHistory, { role: 'assistant', text: "Connection error." }];
        } finally {
            isTyping = false;
            await scrollToBottom();
        }
    }
</script>

<!-- The rest of your HTML/CSS remains exactly the same -->
<div class="chat-wrapper">
    <div class="header">
        <h1>League Data Test</h1>
    </div>
    <div class="chat-container" bind:this={chatContainer}>
        {#each chatHistory as message}
            <div class="message {message.role}" in:fly={{ y: 20, duration: 300 }}>
                <div class="bubble">{message.text}</div>
            </div>
        {/each}
        {#if isTyping}<div class="message assistant"><div class="bubble typing"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div></div>{/if}
    </div>
    <form class="input-area" on:submit|preventDefault={askQuestion}>
        <input type="text" bind:value={query} placeholder="Ask about league settings..." />
        <button type="submit">Send</button>
    </form>
</div>

<style>
    /* Use your existing styles here */
</style>

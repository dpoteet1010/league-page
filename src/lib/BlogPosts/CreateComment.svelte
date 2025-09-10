<script>
    import Button, { Label } from "@smui/button";
    import Textfield from "@smui/textfield";
    import { createEventDispatcher } from 'svelte';

    export let showWrite;

    const dispatch = createEventDispatcher();

    let comment = '';
    let author = '';

    // UI logs array
    let logs = [];

    const logToUI = (msg) => {
        logs = [...logs, msg];
        console.log(msg); // also log to console
    }

    const submit = () => {
        if(comment.trim() === '') {
            logToUI("Cannot submit empty comment.");
            return;
        }
        if(author.trim() === '') {
            logToUI("Author cannot be empty.");
            return;
        }

        logToUI(`Submitting comment: "${comment}" by author: "${author}"`);

        dispatch('createComment', { comment, author });
    }

    const toggleShow = () => {
        showWrite = !showWrite;
        logToUI(`Toggled comment box. showWrite = ${showWrite}`);
    }
</script>

<style>
    .commentTextBox {
        background-color: var(--fff);
        color: var(--g333);
        width: 99%;
        height: 7em;
        font-family: var(--mdc-typography-body1-font-family, var(--mdc-typography-font-family, Roboto, sans-serif));
        font-size: var(--mdc-typography-body1-font-size, 1rem);
    }

    .commentTextBox:focus {
        outline: none;
        border: 1px solid var(--blueOne);
    }

    .submitArea {
        margin: 0;
        padding: 1em 2em 0;
    }

    .textBoxHolder {
        text-align: center;
    }

    .logs {
        margin-top: 1em;
        padding: 1em;
        background-color: #f5f5f5;
        border: 1px solid #ccc;
        font-size: 0.9em;
        max-height: 200px;
        overflow-y: auto;
    }

    .log-entry {
        margin-bottom: 0.5em;
    }
</style>

{#if showWrite}
    <div class="textBoxHolder">
        <textarea
            autofocus
            bind:value={comment}
            placeholder="Leave a comment..."
            class="commentTextBox"
        />
    </div>

    <div class="submitArea">
        <Textfield
            class="shaped-outlined"
            variant="outlined"
            bind:value={author}
            label="Your Sleeper Username"
        />
        <Button onclick={submit} variant="unelevated">
            <Label>Submit Comment</Label>
        </Button>
        <Button onclick={toggleShow} color="secondary" variant="unelevated">
            <Label>Cancel</Label>
        </Button>
    </div>
{:else}
    <div class="submitArea">
        <Button onclick={toggleShow} variant="unelevated">
            <Label>Leave a Comment</Label>
        </Button>
    </div>
{/if}

<!-- UI Logs -->
{#if logs.length > 0}
    <div class="logs">
        <strong>Logs:</strong>
        {#each logs as log}
            <div class="log-entry">{log}</div>
        {/each}
    </div>
{/if}

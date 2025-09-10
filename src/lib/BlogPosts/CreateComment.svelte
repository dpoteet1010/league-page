<script>
    import Button, {Label} from "@smui/button";
    import Textfield from "@smui/textfield";
    import { createEventDispatcher } from 'svelte';

    export let showWrite = false;
    const dispatch = createEventDispatcher();

    let comment = '';
    let author = '';

    const toggleShow = () => {
        showWrite = !showWrite;
    }

    const submit = () => {
        console.log("Dispatching createComment event:", { comment, author });
        dispatch('createComment', { comment, author });
    }
</script>

{#if showWrite}
    <div class="textBoxHolder">
        <textarea autofocus bind:value={comment} class="commentTextBox" placeholder="Leave a comment..."/>
    </div>

    <div class="submitArea">
        <Textfield bind:value={author} label="Your Sleeper Username" variant="outlined" />
        <Button on:click={submit} variant="unelevated">
            <Label>Submit Comment</Label>
        </Button>
        <Button on:click={toggleShow} color="secondary" variant="unelevated">
            <Label>Cancel</Label>
        </Button>
    </div>
{:else}
    <div class="submitArea">
        <Button on:click={toggleShow} variant="unelevated">
            <Label>Leave a Comment</Label>
        </Button>
    </div>
{/if}

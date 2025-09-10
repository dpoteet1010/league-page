<script>
    import Button, {Label} from "@smui/button";
    import Textfield from "@smui/textfield";
	import { createEventDispatcher } from 'svelte';

    export let showWrite;

	const dispatch = createEventDispatcher();

    let comment = '';
    let author = '';

    const submit = () => {
        console.log("Child submit clicked. Comment:", comment, "Author:", author); // <-- log
        dispatch('createComment', {comment, author});
    }

    const toggleShow = () => {
        showWrite = !showWrite;
        console.log("Toggled showWrite:", showWrite); // <-- log
    }
</script>

{#if showWrite}
    <div style="text-align:center;">
        <textarea 
            bind:value={comment} 
            placeholder="Leave a comment..." 
            style="width:99%; height:7em; font-size:1rem;"
        ></textarea>
    </div>

    <div style="margin: 1em 0;">
        <Textfield 
            bind:value={author} 
            label="Your Sleeper Username" 
            style="width:100%;" 
        />
        <Button onclick={submit} variant="unelevated">
            <Label>Submit Comment</Label>
        </Button>
        <Button onclick={toggleShow} color="secondary" variant="unelevated">
            <Label>Cancel</Label>
        </Button>
    </div>
{:else}
    <div style="margin: 1em 0;">
        <Button onclick={toggleShow} variant="unelevated">
            <Label>Leave a Comment</Label>
        </Button>
    </div>
{/if}

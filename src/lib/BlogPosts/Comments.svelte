<script>
    import { getAuthor, getAvatar, parseDate } from "$lib/utils/helper";
    import Icon from "@smui/textfield/icon";
    import CreateComment from "./CreateComment.svelte";
    import Dialog, { Title, Content, Actions } from '@smui/dialog';
    import Button, {Label} from "@smui/button";

    export let comments = [];
    export let total = 0;
    export let leagueTeamManagers;
    export let postID;

    let showWrite = false;
    let open = false;
    let errorMessage = '';

    // Validate that the author exists in leagueTeamManagers
    const validateID = (author) => {
        const auth = author.trim().toLowerCase();
        for (const uID in leagueTeamManagers.users) {
            const user = leagueTeamManagers.users[uID];
            if (user.user_name?.trim().toLowerCase() === auth) {
                return uID; // Return userID for API
            }
        }
        return false;
    }

    // Handles comment submission from child
    const addComment = async (e) => {
        console.log("Parent received event:", e.detail);
        const { comment, author } = e.detail;

        if (!comment || comment.trim() === "") {
            errorMessage = "Comment cannot be empty";
            open = true;
            return;
        }

        const validAuthor = validateID(author);
        if (!validAuthor) {
            errorMessage = "Unauthorized user";
            open = true;
            return;
        }

        console.log("Submitting comment to API:", { comment, validAuthor, postID });

        try {
            const res = await fetch(`/api/addBlogComments/${validAuthor}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ comment: comment.trim(), postID })
            });

            const newComment = await res.json();

            console.log("API response:", newComment);

            if (!res.ok) {
                errorMessage = newComment?.message || JSON.stringify(newComment);
                open = true;
                return;
            }

            comments = [...comments, newComment];
            total++;
            showWrite = false;
        } catch (err) {
            console.error("Error submitting comment:", err);
            errorMessage = err.message || "Unknown error";
            open = true;
        }
    }
</script>

<Dialog bind:open aria-labelledby="simple-title" aria-describedby="simple-content">
    <Title id="simple-title">Error</Title>
    <Content id="simple-content">{errorMessage}</Content>
    <Actions>
        <Button on:click={() => open = false}><Label>Ok</Label></Button>
    </Actions>
</Dialog>

<div class="comments">
    <div class="commentHeader">
        <Icon class="material-icons commentIcon">comment</Icon>
        Comments ({total})
    </div>

    {#each comments as comment}
        <div class="comment">
            <img alt="author avatar" class="teamAvatar" src="{getAvatar(leagueTeamManagers, comment.fields.author)}" />
            <span class="author">{@html getAuthor(leagueTeamManagers, comment.fields.author)} - </span>
            <span class="commentText">{@html comment.fields.comment}</span>
            <div class="date"><i>{parseDate(comment.sys.createdAt)}</i></div>
        </div>
    {/each}

    <!-- Child component with correct event listener -->
    <CreateComment bind:showWrite={showWrite} on:createComment={addComment} />
</div>

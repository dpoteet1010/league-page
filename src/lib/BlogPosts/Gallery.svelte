<script>
  export let images = [];
  let current = 0;
  let interval;

  const next = () => current = (current + 1) % images.length;
  const prev = () => current = (current - 1 + images.length) % images.length;

  // auto-advance every 3s
  $: {
    clearInterval(interval);
    if (images.length > 1) {
      interval = setInterval(next, 3000);
    }
  }

  // cleanup on destroy
  import { onDestroy } from "svelte";
  onDestroy(() => clearInterval(interval));
</script>

<div class="gallery">
  {#if images.length > 1}
    <button class="nav left" on:click={prev}>&lt;</button>
  {/if}

  <img src={images[current].url} alt={images[current].title} />

  {#if images.length > 1}
    <button class="nav right" on:click={next}>&gt;</button>
  {/if}
</div>

<style>
  .gallery {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 1em 0;
  }

  img {
    max-width: 100%;
    max-height: 500px;
    border-radius: 0.5em;
    object-fit: contain;
  }

  .nav {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    background: rgba(255, 255, 255, 0.7);
    border: none;
    font-size: 2em;
    cursor: pointer;
    color: var(--g333);
    padding: 0.2em 0.5em;
    border-radius: 0.3em;
  }

  .nav.left {
    left: 0.5em;
  }

  .nav.right {
    right: 0.5em;
  }
</style>

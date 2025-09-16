<script>
  export let images = [];
  let current = 0;

  const next = () => current = (current + 1) % images.length;
  const prev = () => current = (current - 1 + images.length) % images.length;
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
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5em;
    margin: 1em 0;
  }
  img {
    max-width: 100%;
    max-height: 500px;
    border-radius: 0.5em;
    object-fit: contain;
  }
  .nav {
    background: none;
    border: none;
    font-size: 2em;
    cursor: pointer;
    color: var(--g333);
  }
</style>

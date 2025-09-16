<script>
  export let images = [];

  let current = 0;

  function prev() {
    current = (current - 1 + images.length) % images.length;
  }

  function next() {
    current = (current + 1) % images.length;
  }

  function goTo(index) {
    current = index;
  }
</script>

<style>
  .gallery {
    position: relative;
    width: 100%;
    max-width: 800px;
    margin: 1em auto;
    overflow: hidden;
    border-radius: 10px;
  }

  .gallery img {
    width: 100%;
    height: auto;
    display: block;
    border-radius: 10px;
  }

  .nav {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    background: rgba(0,0,0,0.5);
    color: white;
    border: none;
    padding: 0.5em 1em;
    cursor: pointer;
    font-size: 1.5em;
    border-radius: 5px;
    user-select: none;
  }

  .prev {
    left: 10px;
  }

  .next {
    right: 10px;
  }

  .dots {
    text-align: center;
    margin-top: 0.5em;
  }

  .dot {
    display: inline-block;
    width: 12px;
    height: 12px;
    margin: 0 4px;
    background: #ccc;
    border-radius: 50%;
    cursor: pointer;
  }

  .dot.active {
    background: #333;
  }
</style>

{#if images.length > 0}
  <div class="gallery">
    <img src={"https:" + images[current].url} alt={images[current].title} />
    <button class="nav prev" on:click={prev}>&#10094;</button>
    <button class="nav next" on:click={next}>&#10095;</button>
  </div>

  <div class="dots">
    {#each images as _, index}
      <span
        class="dot {index === current ? 'active' : ''}"
        on:click={() => goTo(index)}
      ></span>
    {/each}
  </div>
{/if}

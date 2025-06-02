<script>
  import Header from './Header.svelte';
  import Footer from './Footer.svelte';
</script>

<Header />

<main>
  <slot></slot>
<div>dasdad</div>
</main>

<Footer />

<style>
  main {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 1rem;
    width: 100%;
    max-width: 64rem;
    margin: 0 auto;
    box-sizing: border-box;
  }
</style>
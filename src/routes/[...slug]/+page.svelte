<script lang="ts">
    import GenerativeHtml from "$lib/GenerativeHTML.svelte";
    let {data} = $props();

</script>

{@html data.html}
 

<style>
  main {
    padding: 1rem;
  }
</style>
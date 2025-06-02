<script lang="ts">
  import { page } from '$app/state';
    import { GenerateHtml } from './AI/PageGenerator';

interface Props {
		description: string;
		
	}
let {description} = $props()
const route = page.url.pathname;
let content = '';


</script>


{@html content}

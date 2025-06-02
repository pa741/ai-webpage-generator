<script lang="ts">

interface Props {
		description: string;
		
	}
let {description} = $props()
const route = window.location.pathname;
const content = `<div> this is a test ${route}</div>`



</script>


{@html content}

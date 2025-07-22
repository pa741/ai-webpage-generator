/** @type {import('tailwindcss').Config} */
module.exports = {
    // 1. content: Specifies which files Tailwind should scan for class names.
    // This is crucial for Tailwind's JIT (Just-In-Time) mode and purging unused CSS.
    content: [
        './src/**/*.{html,js,svelte,ts}', // SvelteKit projects commonly use these extensions
        './src/lib/**/*.{html,js,svelte,ts}', // Include any 'lib' directory if you have one
        './index.html', // If you have a root index.html
        // You can add more paths here, e.g., for Markdown files if you process them
        // './posts/**/*.md',
    ],

    // 2. theme: Extends Tailwind's default design system.
    // This is where you customize colors, fonts, spacing, breakpoints, etc.
    theme: {
        // extend: Allows you to add to Tailwind's defaults without overwriting them.
        extend: {
            colors: {
                'primary': '#FF6363',    // Custom primary color
                'secondary': '#6366F1',  // Custom secondary color
                'brand-blue': '#1DA1F2', // Example: a specific brand color
            },
            fontFamily: {
                // Add custom font families. Make sure these fonts are loaded in your CSS.
                'sans': ['Roboto', 'sans-serif'],
                'serif': ['Merriweather', 'serif'],
                'display': ['Oswald', 'sans-serif'],
            },
            spacing: {
                '128': '32rem', // Custom spacing unit
                '144': '36rem',
            },
            borderRadius: {
                '4xl': '2rem', // Custom border-radius
            },
            // You can extend other default properties like screens (breakpoints),
            // animation, backgroundImage, etc.
            screens: {
                'tall': { 'raw': '(min-height: 800px)' }, // Custom media query
            },
        },
        // If you define properties directly under 'theme' (outside 'extend'),
        // you will *overwrite* Tailwind's defaults for that property.
        // For example, if you define colors here, only your defined colors will be available.
        // colors: {
        //   red: '#FF0000', // This would remove all default Tailwind colors like blue, green, etc.
        // }
    },

    // 3. variants: Configures which variants (e.g., hover, focus, responsive)
    // are generated for which utility plugins.
    // In Tailwind CSS v3.0+, variants are enabled for most utilities by default,
    // so you often don't need to configure this section unless you have
    // specific advanced use cases or are using an older version.
    // Example (less common now):
    // variants: {
    //   extend: {
    //     backgroundColor: ['active'],
    //     textColor: ['visited'],
    //   },
    // },

    // 4. plugins: Adds Tailwind CSS plugins for more advanced features or custom utilities.
    plugins: [
    ],

    // 5. prefix: (Optional) Adds a prefix to all Tailwind classes.
    // Useful if you need to prevent conflicts with existing CSS frameworks.
    // prefix: 'tw-', // Example: classes would become tw-bg-blue-500

    // 6. important: (Optional) Configures how Tailwind's !important rule is applied.
    // important: true, // Makes all Tailwind utilities !important
    // important: '#app', // Scopes !important to a specific selector
};
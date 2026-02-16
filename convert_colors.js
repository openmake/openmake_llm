import { formatHex, oklch } from 'culori';

const colors = {
  purple: {
    dark: {
      background: 'oklch(29.68% 0.0791 315.62)',
      secondary: 'oklch(100% 0 0)', // White
      main: 'oklch(67.34% 0.2314 309.13)',
      border: 'oklch(0% 0 0)'
    }
  },
  lime: {
    dark: {
      background: 'oklch(23.1% 0.0346 126.75)',
      secondary: 'oklch(100% 0 0)',
      main: 'oklch(76.26% 0.21309 132.4002)',
      border: 'oklch(0% 0 0)'
    }
  },
  defaultDark: {
     background: 'oklch(29.12% 0.0633 270.86)', // from globals.css
     secondary: 'oklch(23.93% 0 0)',
     main: 'oklch(67.47% 0.1725 259.61)',
     border: 'oklch(0% 0 0)'
  }
};

Object.entries(colors).forEach(([theme, modes]) => {
  console.log(`\nTheme: ${theme}`);
  if (modes.dark) {
    Object.entries(modes.dark).forEach(([key, val]) => {
      try {
        console.log(`  ${key}: ${formatHex(val)} (${val})`);
      } catch (e) {
        console.log(`  ${key}: ${val} (Error converting)`);
      }
    });
  } else {
      Object.entries(modes).forEach(([key, val]) => {
      try {
        console.log(`  ${key}: ${formatHex(val)} (${val})`);
      } catch (e) {
        console.log(`  ${key}: ${val} (Error converting)`);
      }
    });
  }
});

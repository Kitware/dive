import { useDisplay, useTheme } from 'vuetify';

const useVuetify = () => {
  const theme = useTheme();
  const display = useDisplay();

  return {
    theme,
    breakpoint: display,
    icons: {
      fileNew: 'mdi-file-plus',
      folderNew: 'mdi-folder-plus',
      userHome: 'mdi-home',
      user: 'mdi-account',
      collection: 'mdi-folder-multiple',
      globe: 'mdi-earth',
    },
  };
};

export default useVuetify;

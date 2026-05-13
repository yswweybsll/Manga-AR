export type StudioWindowOptions = {
  width: number;
  height: number;
  title: string;
};

export function getDefaultStudioWindowOptions(): StudioWindowOptions {
  return {
    width: 1280,
    height: 800,
    title: 'Manga AR Studio',
  };
}

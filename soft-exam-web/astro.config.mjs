import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  devToolbar: { enabled: false },
  integrations: [
    starlight({
      title: 'SoftExam',
      description: '系统集成项目管理工程师学习资料',
      defaultLocale: 'root',
      locales: { root: { label: '简体中文', lang: 'zh-CN' } },
      customCss: ['./src/styles/custom.css'],
      components: {
        Pagination: './src/components/Pagination.astro',
      },
      sidebar: [
        { label: '开始复习', items: [{ autogenerate: { directory: '00-开始复习' } }] },
        { label: '精华知识点', items: [{ autogenerate: { directory: '01-精华知识点' } }] },
        { label: '计算与专项', items: [{ autogenerate: { directory: '02-计算与专项' } }] },
        { label: '案例与真题', items: [{ autogenerate: { directory: '03-案例与真题' } }] },
        { label: '附录', items: [{ autogenerate: { directory: '04-附录' } }] },
      ],
    }),
  ],
});

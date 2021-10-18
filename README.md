# bops-bang

bops 拆分迁移到微应用工具。

功能：

-   自动生成 qbp 子项目
-   自动迁移文件及其依赖到生成的子项目中
-   路由自动注册
-   生成 node 层接口依赖提示文档
-   生成 i18n 依赖提示文档

> 本工具在生成 qbp 子项目时依赖于 `create-react-app`、`@qxwz/react-scripts`、`@qxwz/cra-template-bops`

### 需要人工完成的事项：

-   移除全球化语言支持 intl.get
-   剔除子项目中没有使用到的 store 和 service
-   替换 node 层接口调用
-   修复 eslint
-   其他你想做的代码重构

> node 层接口依赖文件可参考生成子项目时的 `help-ajax.txt` 文件。
> i18 依赖文件可参考生成子项目时的 `help-i18n.txt` 文件。

### 注意事项：

-   项目中存在的两种 store 注入方式 `@inject('vipOrderStore')` 和 `useStore<MemberStore>('memberStore')`
-   因为 bops 里面使用的路由是精确匹配，所以新应用也需要采用精确路由匹配

# 用法

指定 npm 安装源 `~/.npmrc` ：

```
@qxwz:registry=http://npm.wz-inc.com
registry=https://registry.npm.taobao.org
```

```bash
npm install -g @qxwz/bang

# 进入 bops 根目录执行
bang YOUR_APP_NAME CONFIG_PATH
```

# 配置文件(json)

```js
[
    {
        // 路由path
        routePath: '/',
        // 原路由中组件引用路径，和 router/router.js 里面的引用路径一致
        componentPath: '../view/home/home.tsx',
    },
];
```

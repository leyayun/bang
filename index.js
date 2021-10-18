'use strict';
const fs = require('fs-extra');
const path = require('path');
const parser = require('@babel/parser');
const astTypes = require('@babel/types');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;
const chalk = require('chalk');
const execa = require('execa');

const log = console.log;

const destProject = process.argv[2];
const migrationConfig = process.argv[3] || 'migration.config.json';
log('process.argv', process.argv);

const bopsPath = path.resolve(process.cwd(), './');
const bopsPkgPath = path.resolve(bopsPath, 'package.json');
const bopsRouterPath = path.resolve(bopsPath, 'src/router/router.js');
const bopsRouterDir = path.parse(bopsRouterPath).dir;
log({ bopsPath, bopsPkgPath, bopsRouterPath, bopsRouterDir });

const destProjectDir = bopsPath.replace('bops', destProject);
const destPkgPath = path.resolve(destProjectDir, 'package.json');
const destEnvPath = path.resolve(destProjectDir, '.env');
const destRouterConfigPath = path.resolve(destProjectDir, 'src/router/config.ts');
const destAjaxHelpTxt = path.resolve(destProjectDir, 'help-ajax.txt');
const destI18nHelpTxt = path.resolve(destProjectDir, 'help-i18n.txt');

const jsExtReg = /(\.tsx)|(\.jsx)|(\.ts)|(\.js)$/;

if (!migrationConfig) {
    throw new Error('migration config not provided');
}

if (!destProject) {
    throw new Error('dest project name not provided');
}

const copy = async (src) => {
    const dest = src.replace('bops', destProject);
    if (fs.existsSync(dest)) {
        return;
    }
    const srcDir = path.parse(src).dir;
    const destDir = srcDir.replace('bops', destProject);
    await fs.ensureDir(destDir);
    await fs.copy(src, dest);
};

const resolveJSPathWithExtension = (dependencePath) => {
    if (jsExtReg.test(dependencePath)) {
        return dependencePath;
    }

    const extension = ['ts', 'tsx', 'js', 'jsx'].find((ext) => fs.existsSync(`${dependencePath}.${ext}`));
    if (extension) {
        return `${dependencePath}.${extension}`;
    }

    const indexExtension = ['ts', 'tsx', 'js', 'jsx'].find((ext) => fs.existsSync(`${dependencePath}/index.${ext}`));
    if (indexExtension) {
        return `${dependencePath}/index.${indexExtension}`;
    }
};

const bopsPkg = fs.readJsonSync(bopsPkgPath);
let destPkg = null;

const importHandler = (astPath, entryDir) => {
    const importPath = astPath.node.source.value;

    if (importPath.startsWith('.')) {
        // 处理本地依赖
        const dependencePath = path.resolve(entryDir, importPath);
        const jsDependencePath = resolveJSPathWithExtension(dependencePath);
        if (jsDependencePath) {
            searchDependenciesAndCopy(jsDependencePath);
        } else {
            copy(dependencePath);
        }
    } else {
        // 处理node_modules依赖
        const packageVersion = bopsPkg.devDependencies[importPath] || bopsPkg.dependencies[importPath];

        // 为新工程添加 npm 依赖
        const destPackageVersion = destPkg.dependencies[importPath];
        if (!destPackageVersion) {
            destPkg.dependencies[importPath] = packageVersion;
        }

        // 为新工程添加 types 依赖
        const typesPackage = `@types/${importPath}`;
        const typesPackageVersion = bopsPkg.devDependencies[typesPackage];
        if (typesPackageVersion) {
            const destTypesPackageVersion = destPkg.dependencies[typesPackage];
            if (!destTypesPackageVersion) {
                destPkg.dependencies[typesPackage] = typesPackageVersion;
            }
        }
    }
};

const astParse = (code) =>
    parser.parse(code, {
        sourceType: 'module',
        plugins: ['typescript', 'jsx', 'decorators-legacy', 'classProperties'],
    });

const genHelperTxt = (helperPath, tipTxt, outputPath) => {
    if (!fs.existsSync(helperPath)) {
        fs.ensureFileSync(helperPath);
        fs.writeFileSync(helperPath, `${tipTxt}\n`);
    }
    const buf = fs.readFileSync(helperPath);
    const helpTextExists = buf.toString().includes(outputPath);
    if (!helpTextExists) {
        fs.appendFileSync(helperPath, `${outputPath}\n`);
    }
};

const searchDependenciesAndCopy = (entryPath) => {
    copy(entryPath);

    const buf = fs.readFileSync(entryPath);
    const ast = astParse(buf.toString());
    const entryDir = path.parse(entryPath).dir;

    traverse(ast, {
        ImportDeclaration(astPath) {
            importHandler(astPath, entryDir);

            const outputPath = entryPath.replace('bops', destProject);

            if (astPath.node.source.value.endsWith('/ajax')) {
                genHelperTxt(destAjaxHelpTxt, '*** 下列文件依赖了 node 层接口，请重构接口调用 ***', outputPath);
            }

            if (astPath.node.source.value === 'react-intl-universal') {
                genHelperTxt(destI18nHelpTxt, '*** 下列文件依赖了i18n服务，请移除依赖 ***', outputPath);
            }
        },
        ExportNamedDeclaration(astPath) {
            if (astPath.node.source) {
                importHandler(astPath, entryDir);
            }
        },
        ExportAllDeclaration(astPath) {
            if (astPath.node.source) {
                importHandler(astPath, entryDir);
            }
        },
    });
};

const registerRoutes = (elements) => {
    const configBuf = fs.readFileSync(destRouterConfigPath);
    const ast = astParse(configBuf.toString());
    console.log('*** Register routes ***');
    traverse(ast, {
        VariableDeclarator(p) {
            if (p.node.id.name === 'routes') {
                const arr = p.get('init');
                arr.replaceWith(astTypes.arrayExpression([...arr.node.elements, ...elements]));
                const { code } = generate(ast, {
                    retainLines: true,
                    compact: false,
                    jsescOption: {
                        wrap: true,
                        quotes: 'single',
                        indentLevel: 4,
                        compact: false,
                    },
                });
                fs.writeFileSync(destRouterConfigPath, code + '\n');
            }
        },
    });
};

// 构建 route 元素语法树
const buildElement = ({ routePath, componentPath }) => {
    const pathKey = astTypes.identifier('path');
    const pathValue = astTypes.stringLiteral(routePath);
    const componentKey = astTypes.identifier('component');
    const callee = astTypes.identifier('lazy');
    const comPath = componentPath.replace(jsExtReg, '');
    const importExpression = astTypes.callExpression(astTypes.import(), [astTypes.stringLiteral(comPath)]);
    const arg = astTypes.arrowFunctionExpression([], importExpression);
    const componentValue = astTypes.callExpression(callee, [arg]);
    return astTypes.objectExpression([astTypes.objectProperty(pathKey, pathValue), astTypes.objectProperty(componentKey, componentValue)]);
};

const migrate = () => {
    destPkg = fs.readJsonSync(destPkgPath);

    const bopsStorePath = path.resolve(bopsPath, 'src/stores/index.ts');
    searchDependenciesAndCopy(bopsStorePath);

    const routes = fs.readJSONSync(migrationConfig);

    const elements = [];
    routes.forEach((route) => {
        const filePath = path.resolve(bopsRouterDir, route.componentPath);
        const depPath = resolveJSPathWithExtension(filePath);
        searchDependenciesAndCopy(depPath);
        elements.push(buildElement(route));
    });

    registerRoutes(elements);

    destPkg.eslintConfig = {
        extends: '@qxwz/eslint-config-react-app',
        rules: {
            '@typescript-eslint/class-name-casing': ['warn'],
            'lines-between-class-members': ['warn'],
            'class-methods-use-this': ['warn'],
            'max-len': ['error', 180],
            '@typescript-eslint/no-unused-vars': ['warn'],
            'react/jsx-closing-tag-location': ['warn'],
        },
    };

    destPkg.scripts = {
        ...destPkg.scripts,
        'codegen-watch': 'graphql-codegen --config codegen.yml --watch',
    };

    fs.writeJsonSync(destPkgPath, destPkg, { spaces: 4 });
    execa('yarn', { cwd: destProjectDir }).stdout.pipe(process.stdout);
    fs.appendFileSync(destEnvPath, `QBP_LIBRARY=${destProject}\n`);
    log(chalk.green('Write dependencies success!'));
};

(() => {
    const destExists = fs.existsSync(destProjectDir);
    log(chalk.grey(destProjectDir, 'exists', destExists));
    if (!destExists) {
        const subprocess = execa('npx', ['create-react-app', destProjectDir, '--scripts-version=@qxwz/react-scripts', '--template=@qxwz/cra-template-bops']);
        subprocess.stdout.pipe(process.stdout);
        subprocess.on('exit', () => {
            migrate();
        });
        subprocess.on('error', (err) => console.error(err));
    } else {
        migrate();
    }
})();

//////////////////////////////////////////////////////////////////////////////////////
//
//  The MIT License (MIT)
//
//  Copyright (c) 2015-present, Dom Chen.
//  All rights reserved.
//
//  Permission is hereby granted, free of charge, to any person obtaining a copy of
//  this software and associated documentation files (the "Software"), to deal in the
//  Software without restriction, including without limitation the rights to use, copy,
//  modify, merge, publish, distribute, sublicense, and/or sell copies of the Software,
//  and to permit persons to whom the Software is furnished to do so, subject to the
//  following conditions:
//
//      The above copyright notice and this permission notice shall be included in all
//      copies or substantial portions of the Software.
//
//  THE SOFTWARE IS PROVIDED *AS IS*, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
//  INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
//  PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
//  HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
//  OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
//  SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
//
//////////////////////////////////////////////////////////////////////////////////////

namespace ts {

    let checker: TypeChecker;
    let sourceFiles: SourceFile[];
    let rootFileNames: string[];
    let dependencyMap: Map<string[]>;
    let pathWeightMap: Map<number>;

    export interface SortingResult {
        sortedFileNames: string[],
        circularReferences: string[]
    }

    export function reorderSourceFiles(program: Program): SortingResult {
        sourceFiles = program.getSourceFiles();
        rootFileNames = program.getRootFileNames();
        checker = program.getTypeChecker();
        buildDependencyMap();
        let result = sortOnDependency();
        sourceFiles = null;
        rootFileNames = null;
        checker = null;
        dependencyMap = null;
        return result;
    }


    function addDependency(file: string, dependent: string): void {
        if (file == dependent) {
            return;
        }
        let list = dependencyMap[file];
        if (!list) {
            list = dependencyMap[file] = [];
        }
        if (list.indexOf(dependent) == -1) {
            list.push(dependent);
        }
    }

    function buildDependencyMap(): void {
        dependencyMap = createMap<string[]>();
        for (let i = 0; i < sourceFiles.length; i++) {
            let sourceFile = sourceFiles[i];
            if (sourceFile.isDeclarationFile) {
                continue;
            }
            visitFile(sourceFile);
        }
    }

    function visitFile(sourceFile: SourceFile): void {
        let hasDecorators = !!(sourceFile.transformFlags & TransformFlags.ContainsDecorators);
        let statements = sourceFile.statements;
        let length = statements.length;
        for (let i = 0; i < length; i++) {
            let statement = statements[i];
            if (hasModifier(statement, ModifierFlags.Ambient)) { // has the 'declare' keyword
                continue;
            }
            visitStatement(statements[i], hasDecorators);
        }
    }

    function visitStatement(statement: Statement, hasDecorators?: boolean): void {
        if (!statement) {
            return;
        }
        switch (statement.kind) {
            case SyntaxKind.ExpressionStatement:
                let expression = <ExpressionStatement>statement;
                visitExpression(expression.expression);
                break;
            case SyntaxKind.ClassDeclaration:
                checkInheriting(<ClassDeclaration>statement);
                visitStaticMember(<ClassDeclaration>statement);
                if (hasDecorators) {
                    visitClassDecorators(<ClassDeclaration>statement);
                }
                break;
            case SyntaxKind.VariableStatement:
                visitVariableList((<VariableStatement>statement).declarationList);
                break;
            case SyntaxKind.ImportEqualsDeclaration:
                let importDeclaration = <ImportEqualsDeclaration>statement;
                checkDependencyAtLocation(importDeclaration.moduleReference);
                break;
            case SyntaxKind.ModuleDeclaration:
                visitModule(<ModuleDeclaration>statement, hasDecorators);
                break;
            case SyntaxKind.Block:
                visitBlock(<Block>statement);
                break;
            case SyntaxKind.IfStatement:
                const ifStatement = <IfStatement>statement;
                visitExpression(ifStatement.expression);
                visitStatement(ifStatement.thenStatement);
                visitStatement(ifStatement.elseStatement);
                break;
            case SyntaxKind.DoStatement:
            case SyntaxKind.WhileStatement:
            case SyntaxKind.WithStatement:
                const doStatement = <DoStatement>statement;
                visitExpression(doStatement.expression);
                visitStatement(doStatement.statement);
                break;
            case SyntaxKind.ForStatement:
                const forStatement = <ForStatement>statement;
                visitExpression(forStatement.condition);
                visitExpression(forStatement.incrementor);
                if (forStatement.initializer) {
                    if (forStatement.initializer.kind === SyntaxKind.VariableDeclarationList) {
                        visitVariableList(<VariableDeclarationList>forStatement.initializer);
                    }
                    else {
                        visitExpression(<Expression>forStatement.initializer);
                    }
                }
                break;
            case SyntaxKind.ForInStatement:
            case SyntaxKind.ForOfStatement:
                const forInStatement = <ForInStatement>statement;
                visitExpression(forInStatement.expression);
                if (forInStatement.initializer) {
                    if (forInStatement.initializer.kind === SyntaxKind.VariableDeclarationList) {
                        visitVariableList(<VariableDeclarationList>forInStatement.initializer);
                    }
                    else {
                        visitExpression(<Expression>forInStatement.initializer);
                    }
                }
                break;
            case SyntaxKind.ReturnStatement:
                visitExpression((<ReturnStatement>statement).expression);
                break;
            case SyntaxKind.SwitchStatement:
                const switchStatment = <SwitchStatement>statement;
                visitExpression(switchStatment.expression);
                switchStatment.caseBlock.clauses.forEach(element => {
                    if (element.kind === SyntaxKind.CaseClause) {
                        visitExpression((<CaseClause>element).expression);
                    }
                    (<DefaultClause>element).statements.forEach(element => {
                        visitStatement(element);
                    })
                });
                break;
            case SyntaxKind.LabeledStatement:
                visitStatement((<LabeledStatement>statement).statement);
                break;
            case SyntaxKind.ThrowStatement:
                visitExpression((<ThrowStatement>statement).expression);
                break;
            case SyntaxKind.TryStatement:
                const tryStatement = <TryStatement>statement;
                visitBlock(tryStatement.tryBlock);
                visitBlock(tryStatement.finallyBlock);
                if (tryStatement.catchClause) {
                    visitBlock(tryStatement.catchClause.block);
                }
                break;
        }
    }

    function visitModule(node: ModuleDeclaration, hasDecorators?: boolean): void {
        if (node.body.kind == SyntaxKind.ModuleDeclaration) {
            visitModule(<ModuleDeclaration>node.body);
            return;
        }
        let statements = (<ModuleBlock>node.body).statements;
        let length = statements.length;
        for (let i = 0; i < length; i++) {
            let statement = statements[i];
            if (hasModifier(statement, ModifierFlags.Ambient)) { // has the 'declare' keyword
                continue;
            }
            visitStatement(statement, hasDecorators);
        }
    }

    function checkDependencyAtLocation(node: Node): void {
        let symbol = checker.getSymbolAtLocation(node);
        if (!symbol || !symbol.valueDeclaration) {
            return;
        }
        let sourceFile = getSourceFileOfNode(symbol.valueDeclaration);
        if (!sourceFile || sourceFile.isDeclarationFile) {
            return;
        }
        addDependency(getSourceFileOfNode(node).fileName, sourceFile.fileName);
    }

    function checkInheriting(node: ClassDeclaration): void {
        if (!node.heritageClauses) {
            return;
        }
        let heritageClause: HeritageClause = null;
        for (const clause of node.heritageClauses) {
            if (clause.token === SyntaxKind.ExtendsKeyword) {
                heritageClause = clause;
                break;
            }
        }
        if (!heritageClause) {
            return;
        }
        let superClasses = heritageClause.types;
        if (!superClasses) {
            return;
        }
        superClasses.forEach(superClass => {
            checkDependencyAtLocation(superClass.expression);
        });
    }

    function visitStaticMember(node: ClassDeclaration): void {
        let members = node.members;
        if (!members) {
            return;
        }
        for (let member of members) {
            if (!hasModifier(member, ModifierFlags.Static)) {
                continue;
            }
            if (member.kind == SyntaxKind.PropertyDeclaration) {
                let property = <PropertyDeclaration>member;
                visitExpression(property.initializer);
            }
        }
    }

    function visitClassDecorators(node: ClassDeclaration): void {
        if (node.decorators) {
            visitDecorators(node.decorators);
        }
        let members = node.members;
        if (!members) {
            return;
        }
        for (let member of members) {
            let decorators: NodeArray<Decorator>;
            let functionLikeMember: FunctionLikeDeclaration;
            if (member.kind === SyntaxKind.GetAccessor || member.kind === SyntaxKind.SetAccessor) {
                const accessors = getAllAccessorDeclarations(node.members, <AccessorDeclaration>member);
                if (member !== accessors.firstAccessor) {
                    continue;
                }
                decorators = accessors.firstAccessor.decorators;
                if (!decorators && accessors.secondAccessor) {
                    decorators = accessors.secondAccessor.decorators;
                }
                functionLikeMember = accessors.setAccessor;
            }
            else {
                decorators = member.decorators;
                if (member.kind === SyntaxKind.MethodDeclaration) {
                    functionLikeMember = <MethodDeclaration>member;
                }
            }
            if (decorators) {
                visitDecorators(decorators);
            }

            if (functionLikeMember) {
                for (const parameter of functionLikeMember.parameters) {
                    if (parameter.decorators) {
                        visitDecorators(parameter.decorators);
                    }
                }
            }
        }
    }

    function visitDecorators(decorators: NodeArray<Decorator>): void {
        for (let decorator of decorators) {
            visitExpression(decorator.expression);
        }
    }

    function visitExpression(expression: Expression): void {
        if (!expression) {
            return;
        }
        switch (expression.kind) {
            case SyntaxKind.NewExpression:
            case SyntaxKind.CallExpression:
                visitCallExpression(<CallExpression>expression);
                break;
            case SyntaxKind.Identifier:
            case SyntaxKind.PropertyAccessExpression:
                checkDependencyAtLocation(expression);
                break;
            case SyntaxKind.ObjectLiteralExpression:
                visitObjectLiteralExpression(<ObjectLiteralExpression>expression);
                break;
            case SyntaxKind.ElementAccessExpression:
                checkDependencyAtLocation((<ElementAccessExpression>expression).expression);
                break;
            case SyntaxKind.ArrayLiteralExpression:
                let arrayLiteral = <ArrayLiteralExpression>expression;
                arrayLiteral.elements.forEach(visitExpression);
                break;
            case SyntaxKind.TemplateExpression:
                let template = <TemplateExpression>expression;
                template.templateSpans.forEach(span => {
                    visitExpression(span.expression);
                });
                break;
            case SyntaxKind.ParenthesizedExpression:
                let parenthesized = <ParenthesizedExpression>expression;
                visitExpression(parenthesized.expression);
                break;
            case SyntaxKind.BinaryExpression:
                let binary = <BinaryExpression>expression;
                visitExpression(binary.left);
                visitExpression(binary.right);
                break;
            case SyntaxKind.PostfixUnaryExpression:
            case SyntaxKind.PrefixUnaryExpression:
                visitExpression((<PrefixUnaryExpression>expression).operand);
                break;
            case SyntaxKind.DeleteExpression:
                visitExpression((<DeleteExpression>expression).expression);
                break;

        }

        // TaggedTemplateExpression
        // TypeAssertionExpression
        // FunctionExpression
        // ArrowFunction
        // TypeOfExpression
        // VoidExpression
        // AwaitExpression
        // ConditionalExpression
        // YieldExpression
        // SpreadElementExpression
        // ClassExpression
        // OmittedExpression
        // ExpressionWithTypeArguments
        // AsExpression
        // NonNullExpression
    }

    function visitObjectLiteralExpression(objectLiteral: ObjectLiteralExpression): void {
        objectLiteral.properties.forEach(element => {
            switch (element.kind) {
                case SyntaxKind.PropertyAssignment:
                    visitExpression((<PropertyAssignment>element).initializer);
                    break;
                case SyntaxKind.ShorthandPropertyAssignment:
                    visitExpression((<ShorthandPropertyAssignment>element).objectAssignmentInitializer);
                    break;
                case SyntaxKind.SpreadAssignment:
                    visitExpression((<SpreadAssignment>element).expression);
                    break;
            }
        });
    }

    function visitCallExpression(callExpression: CallExpression): void {
        callExpression.arguments.forEach(argument => {
            visitExpression(argument);
        });
        let expression = callExpression.expression;
        switch (expression.kind) {
            case SyntaxKind.FunctionExpression:
                let functionExpression = <FunctionExpression>expression;
                visitBlock(functionExpression.body);
                break;
            case SyntaxKind.PropertyAccessExpression:
            case SyntaxKind.Identifier:
                let symbol = checker.getSymbolAtLocation(expression);
                if (!symbol) {
                    return;
                }
                let declaration = symbol.valueDeclaration;
                if (!declaration) {
                    return;
                }
                let sourceFile = getSourceFileOfNode(declaration);
                if (!sourceFile || sourceFile.isDeclarationFile) {
                    return;
                }
                addDependency(getSourceFileOfNode(expression).fileName, sourceFile.fileName);
                if (declaration.kind === SyntaxKind.FunctionDeclaration ||
                    declaration.kind === SyntaxKind.MethodDeclaration) {
                    visitBlock((<FunctionDeclaration>declaration).body);
                }
                else if (declaration.kind === SyntaxKind.ClassDeclaration) {
                    checkClassInstantiation(<ClassDeclaration>declaration);
                }
                break;
        }

    }

    function checkClassInstantiation(node: ClassDeclaration): void {
        let members = node.members;
        if (!members) {
            return;
        }
        for (let member of members) {
            if (hasModifier(member, ModifierFlags.Static)) {
                continue;
            }
            if (member.kind === SyntaxKind.PropertyDeclaration) {
                let property = <PropertyDeclaration>member;
                visitExpression(property.initializer);
            }
            else if (member.kind === SyntaxKind.Constructor) {
                let constructor = <ConstructorDeclaration>member;
                visitBlock(constructor.body);
            }
        }
    }

    function visitBlock(block: Block): void {
        if (!block) {
            return;
        }
        for (let statement of block.statements) {
            visitStatement(statement);
        }
    }

    function visitVariableList(variables: VariableDeclarationList) {
        if (!variables) {
            return;
        }
        variables.declarations.forEach(declaration => {
            visitExpression(declaration.initializer);
        });
    }

    function sortOnDependency(): SortingResult {
        let result: SortingResult = <any>{};
        result.sortedFileNames = [];
        result.circularReferences = [];
        pathWeightMap = createMap<number>();
        for (let i = 0; i < sourceFiles.length; i++) {
            let sourceFile = sourceFiles[i];
            let path = sourceFile.fileName;
            if (sourceFile.isDeclarationFile) {
                pathWeightMap[path] = 10000;
                continue;
            }
            let references = updatePathWeight(path, 0, [path]);
            if (references) {
                result.circularReferences = references;
                break;
            }
        }
        if (result.circularReferences.length === 0) {
            sourceFiles.sort(function (a: SourceFile, b: SourceFile): number {
                return pathWeightMap[b.fileName] - pathWeightMap[a.fileName];
            });
            rootFileNames.length = 0;
            sourceFiles.forEach(sourceFile => {
                rootFileNames.push(sourceFile.fileName);
                if (!sourceFile.hasNoDefaultLib) { // It is a default d.ts file.
                    result.sortedFileNames.push(sourceFile.fileName);
                }
            });
        }
        pathWeightMap = null;
        return result;
    }

    function updatePathWeight(path: string, weight: number, references: string[]): string[] {
        if (pathWeightMap[path] === undefined) {
            pathWeightMap[path] = weight;
        }
        else {
            if (pathWeightMap[path] < weight) {
                pathWeightMap[path] = weight;
            }
            else {
                return null;
            }
        }
        let list = dependencyMap[path];
        if (!list) {
            return null;
        }
        for (let parentPath of list) {
            if (references.indexOf(parentPath) != -1) {
                references.push(parentPath);
                return references;
            }
            let result = updatePathWeight(parentPath, weight + 1, references.concat(parentPath));
            if (result) {
                return result;
            }
        }
        return null;
    }

    function getSourceFileOfNode(node: Node): SourceFile {
        while (node && node.kind !== SyntaxKind.SourceFile) {
            node = node.parent;
        }
        return <SourceFile>node;
    }
}

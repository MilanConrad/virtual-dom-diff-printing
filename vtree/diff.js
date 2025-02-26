var isArray = require("x-is-array")

var VPatch = require("../vnode/vpatch")
var isVNode = require("../vnode/is-vnode")
var isVText = require("../vnode/is-vtext")
var isWidget = require("../vnode/is-widget")
var isThunk = require("../vnode/is-thunk")
var handleThunk = require("../vnode/handle-thunk")

var diffProps = require("./diff-props")

module.exports = diff

var patchTypeNames = {
    0: 'NONE',
    1: 'VTEXT',
    2: 'VNODE',
    3: 'WIDGET',
    4: 'PROPS',
    5: 'ORDER',
    6: 'INSERT',
    7: 'REMOVE',
    8: 'THUNK'
}


function diff(a, b) {
    var patch = {a: a}
    var logEntries = [];
    walk(a, b, patch, 0, logEntries)
    var postProcessedLog = postProcessLog(logEntries);
    // console.log(`Unified Diff Result:\n${postProcessedLog.diffText}`);
    return postProcessedLog
}

function postProcessLog(logEntries) {
    // Extract all the INS and DEL entries
    let insertions = logEntries.map(log => log.match(/\[INS\].+?\[\/INS\]/g) || [])
        .flat()
        .map(entry => entry.replace(/\[INS\]/g, '').replace(/\[\/INS\]/g, ''));

    let deletions = logEntries.map(log => log.match(/\[DEL\].+?\[\/DEL\]/g) || [])
        .flat()
        .map(entry => entry.replace(/\[DEL\]/g, '').replace(/\[\/DEL\]/g, ''));

    // Filter out the insertions that also have a deletion
    let uniqueInsertions = insertions.filter((insertion, index) => {
        // Check if this insertion is followed by a deletion of the same element
        let nextLog = logEntries[index + 1];
        if (nextLog && nextLog.includes(`[DEL]${insertion}[/DEL]`)) {
            // This is a reordering, not a unique insertion
            return false;
        }
        // This is a unique insertion
        return !deletions.includes(insertion);
    });

    // Join the unique insertions into a single string
    let unifiedDiffResult = uniqueInsertions.map(insertion => `[INS]${insertion}[/INS]`).join('\n');

    // Add the deletions that are not followed by an insertion of the same element
    let uniqueDeletions = deletions.filter((deletion, index) => {
        let nextLog = logEntries[index + 1];
        if (nextLog && nextLog.includes(`[INS]${deletion}[/INS]`)) {
            // This is a reordering, not a unique deletion
            return false;
        }
        // This is a unique deletion
        return true;
    });

    // Join the unique deletions into the unified diff result
    unifiedDiffResult += uniqueDeletions.map(deletion => `[DEL]${deletion}[/DEL]`).join('\n');

    return {
        diffText: unifiedDiffResult,
        numInsertions: uniqueInsertions.length,
        numDeletions: uniqueDeletions.length
    };
}

function walk(a, b, patch, index, logEntries) {
    if (a === b) {
        return
    }

    var apply = patch[index]
    var applyClear = false

    if (isThunk(a) || isThunk(b)) {
        thunks(a, b, patch, index)
    } else if (b == null) {
        if (!isWidget(a)) {
            clearState(a, patch, index)
            apply = patch[index]
        }
        var newPatch = new VPatch(VPatch.REMOVE, a, b);
        logEntries.push(`[REMOVE]${extractNodeContent(a)}[/REMOVE]`);
        apply = appendPatch(apply, newPatch);
    } else if (isVNode(b)) {
        if (isVNode(a)) {
            if (a.tagName === b.tagName &&
                a.namespace === b.namespace &&
                a.key === b.key) {
                var propsPatch = diffProps(a.properties, b.properties)
                if (propsPatch) {
                    var newPatch = new VPatch(VPatch.PROPS, a, propsPatch);
                    logEntries.push(`[PROPS]${JSON.stringify(propsPatch)}[/PROPS]`);
                    apply = appendPatch(apply, newPatch);
                }
                apply = diffChildren(a, b, patch, apply, index, logEntries)
            } else {
                var newPatch = new VPatch(VPatch.VNODE, a, b);
                logEntries.push(`[VNODE][DEL]${extractNodeContent(a)}[/DEL][/VNODE] [VNODE][INS]${extractNodeContent(b)}[/INS][/VNODE]`);
                apply = appendPatch(apply, newPatch);
                applyClear = true
            }
        } else if (isVText(a)) {
            var newPatch = new VPatch(VPatch.VTEXT, a, b);
            logEntries.push(`[VTEXT][DEL]${a.text}[/DEL][INS]${b.text}[/INS][VTEXT]`);
            apply = appendPatch(apply, newPatch);
            applyClear = true
        } else {
            var newPatch = new VPatch(VPatch.VNODE, a, b);
            logEntries.push(`[VNODE][DEL]${extractNodeContent(a)}[/DEL][/VNODE] [VNODE][INS]${extractNodeContent(b)}[/INS][/VNODE]`);
            apply = appendPatch(apply, newPatch);
            applyClear = true
        }
    } else if (isVText(b)) {
        if (!isVText(a)) {
            var newPatch = new VPatch(VPatch.VTEXT, a, b);
            logEntries.push(`[VTEXT][DEL]${a.text}[/DEL][INS]${b.text}[/INS][VTEXT]`);
            apply = appendPatch(apply, newPatch);
            applyClear = true
        } else if (a.text !== b.text) {
            var newPatch = new VPatch(VPatch.VTEXT, a, b);
            logEntries.push(`[VTEXT][DEL]${a.text}[/DEL][INS]${b.text}[/INS][VTEXT]`);
            apply = appendPatch(apply, newPatch);
        }
    } else if (isWidget(b)) {
        if (!isWidget(a)) {
            applyClear = true
        }
        var newPatch = new VPatch(VPatch.WIDGET, a, b);
        logEntries.push(`[WIDGET] Old ID: ${a.id}, New ID: ${b.id}`);
        apply = appendPatch(apply, newPatch);
    }

    if (apply) {
        patch[index] = apply
    }

    if (applyClear) {
        clearState(a, patch, index)
    }
}

function extractNodeContent(node) {
    var content = '';
    if (isVNode(node)) {
        if (node.children) {
            content = node.children.map(extractNodeContent).join('');
        }
        var attributes = Object.entries(node.properties.attributes || {}).map(([key, value]) => `${key}="${value}"`).join(' ').trim();
        var properties = Object.entries(node.properties).filter(([key]) => key !== 'attributes').map(([key, value]) => `${key}="${value}"`).join(' ').trim();
        return `<${node.tagName}${attributes ? ' ' + attributes : ''}${properties ? ' ' + properties : ''}>${content}</${node.tagName}>`;
    } else if (isVText(node)) {
        content = node.text;
    }
    return content;
}


function diffChildren(a, b, patch, apply, index, logEntries) {
    var aChildren = a.children
    var orderedSet = reorder(aChildren, b.children)
    var bChildren = orderedSet.children

    var aLen = aChildren.length
    var bLen = bChildren.length
    var len = aLen > bLen ? aLen : bLen

    for (var i = 0; i < len; i++) {
        var leftNode = aChildren[i]
        var rightNode = bChildren[i]
        index += 1

        if (!leftNode) {
            if (rightNode) {
                var newPatch = new VPatch(VPatch.INSERT, null, rightNode);
                logEntries.push(`[INSERT][INS]${extractNodeContent(rightNode)}[/INS][/INSERT]`);
                apply = appendPatch(apply, newPatch);
            }
        } else {
            walk(leftNode, rightNode, patch, index, logEntries)
        }

        if (isVNode(leftNode) && leftNode.count) {
            index += leftNode.count
        }
    }

    if (orderedSet.moves) {
        var newPatch = new VPatch(VPatch.ORDER, a, orderedSet.moves);
        logEntries.push(`[ORDER]${JSON.stringify(orderedSet.moves)}[/ORDER]`);
        apply = appendPatch(apply, newPatch);
    }

    return apply
}

function clearState(vNode, patch, index) {
    // TODO: Make this a single walk, not two
    unhook(vNode, patch, index)
    destroyWidgets(vNode, patch, index)
}

// Patch records for all destroyed widgets must be added because we need
// a DOM node reference for the destroy function
function destroyWidgets(vNode, patch, index) {
    if (isWidget(vNode)) {
        if (typeof vNode.destroy === "function") {
            patch[index] = appendPatch(
                patch[index],
                new VPatch(VPatch.REMOVE, vNode, null)
            )
        }
    } else if (isVNode(vNode) && (vNode.hasWidgets || vNode.hasThunks)) {
        var children = vNode.children
        var len = children.length
        for (var i = 0; i < len; i++) {
            var child = children[i]
            index += 1

            destroyWidgets(child, patch, index)

            if (isVNode(child) && child.count) {
                index += child.count
            }
        }
    } else if (isThunk(vNode)) {
        thunks(vNode, null, patch, index)
    }
}

// Create a sub-patch for thunks
function thunks(a, b, patch, index) {
    var nodes = handleThunk(a, b)
    var thunkPatch = diff(nodes.a, nodes.b)
    if (hasPatches(thunkPatch)) {
        patch[index] = new VPatch(VPatch.THUNK, null, thunkPatch)
    }
}

function hasPatches(patch) {
    for (var index in patch) {
        if (index !== "a") {
            return true
        }
    }

    return false
}

// Execute hooks when two nodes are identical
function unhook(vNode, patch, index) {
    if (isVNode(vNode)) {
        if (vNode.hooks) {
            patch[index] = appendPatch(
                patch[index],
                new VPatch(
                    VPatch.PROPS,
                    vNode,
                    undefinedKeys(vNode.hooks)
                )
            )
        }

        if (vNode.descendantHooks || vNode.hasThunks) {
            var children = vNode.children
            var len = children.length
            for (var i = 0; i < len; i++) {
                var child = children[i]
                index += 1

                unhook(child, patch, index)

                if (isVNode(child) && child.count) {
                    index += child.count
                }
            }
        }
    } else if (isThunk(vNode)) {
        thunks(vNode, null, patch, index)
    }
}

function undefinedKeys(obj) {
    var result = {}

    for (var key in obj) {
        result[key] = undefined
    }

    return result
}

// List diff, naive left to right reordering
function reorder(aChildren, bChildren) {
    // O(M) time, O(M) memory
    var bChildIndex = keyIndex(bChildren)
    var bKeys = bChildIndex.keys
    var bFree = bChildIndex.free

    if (bFree.length === bChildren.length) {
        return {
            children: bChildren,
            moves: null
        }
    }

    // O(N) time, O(N) memory
    var aChildIndex = keyIndex(aChildren)
    var aKeys = aChildIndex.keys
    var aFree = aChildIndex.free

    if (aFree.length === aChildren.length) {
        return {
            children: bChildren,
            moves: null
        }
    }

    // O(MAX(N, M)) memory
    var newChildren = []

    var freeIndex = 0
    var freeCount = bFree.length
    var deletedItems = 0

    // Iterate through a and match a node in b
    // O(N) time,
    for (var i = 0; i < aChildren.length; i++) {
        var aItem = aChildren[i]
        var itemIndex

        if (aItem.key) {
            if (bKeys.hasOwnProperty(aItem.key)) {
                // Match up the old keys
                itemIndex = bKeys[aItem.key]
                newChildren.push(bChildren[itemIndex])

            } else {
                // Remove old keyed items
                itemIndex = i - deletedItems++
                newChildren.push(null)
            }
        } else {
            // Match the item in a with the next free item in b
            if (freeIndex < freeCount) {
                itemIndex = bFree[freeIndex++]
                newChildren.push(bChildren[itemIndex])
            } else {
                // There are no free items in b to match with
                // the free items in a, so the extra free nodes
                // are deleted.
                itemIndex = i - deletedItems++
                newChildren.push(null)
            }
        }
    }

    var lastFreeIndex = freeIndex >= bFree.length ?
        bChildren.length :
        bFree[freeIndex]

    // Iterate through b and append any new keys
    // O(M) time
    for (var j = 0; j < bChildren.length; j++) {
        var newItem = bChildren[j]

        if (newItem.key) {
            if (!aKeys.hasOwnProperty(newItem.key)) {
                // Add any new keyed items
                // We are adding new items to the end and then sorting them
                // in place. In future we should insert new items in place.
                newChildren.push(newItem)
            }
        } else if (j >= lastFreeIndex) {
            // Add any leftover non-keyed items
            newChildren.push(newItem)
        }
    }

    var simulate = newChildren.slice()
    var simulateIndex = 0
    var removes = []
    var inserts = []
    var simulateItem

    for (var k = 0; k < bChildren.length;) {
        var wantedItem = bChildren[k]
        simulateItem = simulate[simulateIndex]

        // remove items
        while (simulateItem === null && simulate.length) {
            removes.push(remove(simulate, simulateIndex, null))
            simulateItem = simulate[simulateIndex]
        }

        if (!simulateItem || simulateItem.key !== wantedItem.key) {
            // if we need a key in this position...
            if (wantedItem.key) {
                if (simulateItem && simulateItem.key) {
                    // if an insert doesn't put this key in place, it needs to move
                    if (bKeys[simulateItem.key] !== k + 1) {
                        removes.push(remove(simulate, simulateIndex, simulateItem.key))
                        simulateItem = simulate[simulateIndex]
                        // if the remove didn't put the wanted item in place, we need to insert it
                        if (!simulateItem || simulateItem.key !== wantedItem.key) {
                            inserts.push({key: wantedItem.key, to: k})
                        }
                        // items are matching, so skip ahead
                        else {
                            simulateIndex++
                        }
                    } else {
                        inserts.push({key: wantedItem.key, to: k})
                    }
                } else {
                    inserts.push({key: wantedItem.key, to: k})
                }
                k++
            }
            // a key in simulate has no matching wanted key, remove it
            else if (simulateItem && simulateItem.key) {
                removes.push(remove(simulate, simulateIndex, simulateItem.key))
            }
        } else {
            simulateIndex++
            k++
        }
    }

    // remove all the remaining nodes from simulate
    while (simulateIndex < simulate.length) {
        simulateItem = simulate[simulateIndex]
        removes.push(remove(simulate, simulateIndex, simulateItem && simulateItem.key))
    }

    // If the only moves we have are deletes then we can just
    // let the delete patch remove these items.
    if (removes.length === deletedItems && !inserts.length) {
        return {
            children: newChildren,
            moves: null
        }
    }

    return {
        children: newChildren,
        moves: {
            removes: removes,
            inserts: inserts
        }
    }
}

function remove(arr, index, key) {
    arr.splice(index, 1)

    return {
        from: index,
        key: key
    }
}

function keyIndex(children) {
    var keys = {}
    var free = []
    var length = children.length

    for (var i = 0; i < length; i++) {
        var child = children[i]

        if (child.key) {
            keys[child.key] = i
        } else {
            free.push(i)
        }
    }

    return {
        keys: keys,     // A hash of key name to index
        free: free      // An array of unkeyed item indices
    }
}

function formatPatch(patch) {
    var type = patch.type
    var vNode = patch.vNode
    var patchData = patch.patch

    switch (type) {
        case VPatch.VTEXT:
            return `<${vNode.tagName}>[DEL]${vNode.text}[/DEL][INS]${patchData.text}[/INS]</${vNode.tagName}>`
        case VPatch.VNODE:
            return `<${vNode.tagName}>[REPLACE]${vNode.children.map(formatPatch)}[/REPLACE]</${vNode.tagName}>`
        case VPatch.WIDGET:
            return `<${vNode.type}>[WIDGET]${vNode.id}[/WIDGET]</${vNode.type}>`
        case VPatch.PROPS:
            return `<${vNode.tagName}>[PROPS]${JSON.stringify(patchData)}[/PROPS]</${vNode.tagName}>`
        case VPatch.ORDER:
            return `<${vNode.tagName}>[ORDER]${JSON.stringify(patchData)}[/ORDER]</${vNode.tagName}>`
        case VPatch.INSERT:
            return `<${patchData.tagName}>[INS]${patchData.children.map(formatPatch)}[/INS]</${patchData.tagName}>`
        case VPatch.REMOVE:
            return `<${vNode.tagName}>[DEL]${vNode.children.map(formatPatch)}[/DEL]</${vNode.tagName}>`
        default:
            return ''
    }
}

function appendPatch(apply, patch) {
    // console.log("Format patch:", formatPatch(patch))
    if (apply) {
        if (isArray(apply)) {
            apply.push(patch)
        } else {
            apply = [apply, patch]
        }

        return apply
    } else {
        return patch
    }
}

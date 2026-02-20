# Move-abs-elems Extension For Quarto

This project integrates a Quarto extension with a VS Code extension to allow interactive manipulation of .absolute elements in Quarto Reveal.js slides.

By dragging img and div elements with the .absolute class in the Quarto preview (or rendered HTML), their positional attributes are automatically updated in the corresponding .qmd file currently open in VS Code.

![](https://github.com/herosi/move-abs-elems/blob/main/move-abs-elems.gif?raw=true)


## ⚠ Important

**Neither extension works independently.**
They are designed to function together and must be used as a pair. **Install both of them first.**


## Installing

### VS Code Extension Setup

Find 'Quarto Move Abs Elems' in the VSCode marketplace and install it.

The server will automatically start on port **37842**.


### Quarto Extension Setup

Install the quarto side extension with the command below.

```bash
quarto add herosi/move-abs-elems
```

This will install the extension under the `_extensions` subdirectory.
If you're using version control, you will want to check in this directory.


## Using

### 1. Add the following to your `_quarto.yml` or to the YAML header of each `.qmd` file:

```yaml
---
filters:
  - move-abs-elems
---
```

### 2. Writing Your `.qmd`

See the [example.qmd](https://github.com/herosi/move-abs-elems) for usage examples.

### 3. Drag & Drop Workflow

3.1. Start Quarto preview (`Ctrl` + `Shift` + `K`)

     * Make sure only one VS Code window is open.
     * Make sure the VS Code extension server is running
     * Make sure the rendered HTML filename is contained in the URL

3.2. In the Quarto preview:

     * Elements with the `.absolute` class are highlighted with a red overlay
     * Hovering over them shows a blue border with a dotted outline

3.3. Drag the element  
3.4. On drop, the corresponding position in the `.qmd` file is automatically updated  
3.5. Save the `.qmd` file to permanently apply the changes  


### Additional Features

* **Resize support**  
  Drag the corners to resize placeholders.

  * Images: the actual image size is updated
  * Text: only the placeholder is resized

* **Undo / Redo**  
  * Windows: `Ctrl+Z` / `Ctrl+Y`
  * macOS: `Cmd+Z` / `Cmd+Shift+Z`
  * Also available via buttons in the preview

  > ⚠ If you use undo/redo directly in the `.qmd` file, the preview will not sync.
  > Always use the preview (or the rendered HTML) for undo/redo operations.
  > Editing the `.qmd` file between undo/redo steps may cause inconsistencies.

* **Temporarily disable edit mode**  
  * Press `Ctrl+Shift+E` to pause editing mode.
  * Press it again to resume.


## Limitations

* **Does not work if multiple VS Code instances are running.**
* Only supports `.absolute` elements (`img` and `div`)
* `top`, `left`, `bottom`, or `right` must be specified in **percent units** (other units are not supported)
* Only one level of nested `div` (grouping) is supported
* `.qmd` files are expected to be located in the project root directory

  * Other layouts may fail
* The filename must be included in the URL of the preview

  * If the Quarto preview URL does not include the filename, the extension cannot determine the corresponding `.qmd` file
  * In that case:

    * Use the rendered HTML file, or
    * Explicitly include the HTML filename in the URL

  Example:

  ```
  http://localhost:3523/#/title-slide
  http://localhost:3523/example.html#/title-slide
  ```


## Troubleshooting

* **Most issues are caused by multiple VS Code instances running.**
  * Make sure only one VS Code window is open.
* Also ensure all limitations listed above are satisfied.


## Example
1. Open the folder that contains `example.qmd` with VS Code.
   * You can find it in the URL below.  
     https://github.com/herosi/move-abs-elems
   * Make sure only one VS Code instance is running.
2. Open `example.qmd` in VS Code, then start the preview by pressing `Ctrl + Shift + K`.
3. In the Preview pane, ensure the rendered HTML filename is included in the URL. If not, include it as shown below:
   ```
   http://localhost:3523/#/title-slide
   ```
   to
   ```
   http://localhost:3523/example.html#/title-slide
   ```
4. Drag an image or a div element.

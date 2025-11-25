# Piximal 2
the successor of Piximal 1. A cellular automata of sorts, but also comparable to the ram of a modern computer. Every image has a canonical next state when passed through the piximal 2 step function (though a random image will most likely have an identical next state). The code, data, input, and output of you program are all contained in your image.
the [datasheet](https://docs.google.com/spreadsheets/d/1l8HzEkNCA6sCJ4xKUMFpFY8GZ-6lLepWTM-r2CtAgQQ/edit?usp=sharing) may come in quite handy if you plan to write programs in piximal 2, along with the pix2 assembly language.

## Layout
- the first pixel specifies the version. for piximal2 this *must* be 2, otherwise nothing will happen.
- the second pixel can be anything.
- the third pixel specifies the number of threads.
- then there are n pointers, each to a thread definition, where n is the number of threads.

## Thread Definition
- each thread definition has two pointers, one to the top of the stack, and the other to the instruction to be executed.
- the stack top pointer points to the first pixel of the frame at the top of the stack.
- the stack top is never used except for in `call` and `return`, and `stp`, `rstp`, `arg`, `loc`, `funcorigin`, and `funcos` (you do not need to define the stack top unless you plan to use functions in your program)

## Stack and Stack Frames
- each stack frame starts with 3 pointers:
 1. the pointer to the function that stack frame is for
 2. the pointer to the frame beneath this one in the stack (where the stack top pointer should be when this function returns). This pointer does not have to be smaller than the current stack top. It could jump somewhere else or even point to this stack frame (making a loop).
 3. the pointer to where execution left off when this function was called (where the instruction pointer should be when this function returns). Note that this does not point to the instruction that *called* the function, but the one after that, the one to be executed *next*.
- the stack frame then reserves space for arguments, then locals. how many arguments and locals to be reserved depend on the function itself (see below).
- the stack is handled automatically by the `call` and `return` functions, but just like everything in piximal2, they can be unsafely manually edited by the program.
- when a function returns, the stack top pointer is moved, but the pixels that made up that stack frame arent removed. they remain the same until they are overwritten by the next call. if you want to clean them up, you must do it manually.

## Functions
- the first pixel in a function definition says how many arguments that function takes (as an unsigned integer less than 2^24)
- the second pixel in a function definition says how many pixels to reserve on the stack for that functions locals. (again as an unsigned int less than 2^24)
- the third pixel and on are the code of the function.
- arguments and locals can be accessed with the `arg` and `loc` special pointers

## Pointers
- there are two types of pointer: special and raw.
- raw pointers are simply a pixel with the index they point to.
- for huge images, raw pointers will be multiple pixels long, big endian. There will be sufficiently many pixel per raw pointer such that every pixel can be represented in one less than the total available bits in that many pixels (basically you can point to any pixel on the image)
- special pointers are a single pixel with the first bit active (the red value is greater than or equal to 128). the remaining bits specify the type of special pointer. (see the [data sheet](https://docs.google.com/spreadsheets/d/1l8HzEkNCA6sCJ4xKUMFpFY8GZ-6lLepWTM-r2CtAgQQ/edit?usp=sharing))
- each pointer supports 4 operations: next index, literal, read, and write.
- next index tells you what is the index of the first pixel not consumed by the definition of this pointer (the complete definition of a pointer may be any number of pixels, this tells you where it ends)
- literal tells you exactly what the pointer is pointing *to*. for raw pointers this is just their value, but for `os` for example, it depends on the offset. some special pointers represent data that is not *in* the image. the literal value of these pointers will simply be the origin of the image.
- read returns a pixel. for raw pointers this simply returns the pixel they are pointing to, but for `wp` for example, it returns a pixel that may not actually exist in the image at all.
- write takes a pixel value and does something with it. for raw pointers this just writes that pixel to the place they are pointing. For special pointer that are meant to be read, writing to them will simply discard (`wp` for example)

## Pix2 Assembly
the pix2 assembly language is a simple assembly language that compiles to an image (or more specifically, it writes to an image that already exists, only overwriting what it needs to). I had to code the parser for pix2 assembly by had in a language I dont like to use, so for that reason it is very bare-bones.
- comments are either single line (`// this is a comment`) or block (`/* this is a block comment */`), just like other languages you are familiar with. comments are removed during preprocessing so block comments can literally be in the middle of a word.
- after preprocessing, the code is separated on whitespace into words.
- if the word is a non-negative number in decimal, or prefixed and in binary, hexadecimal, or octal, then it is written to the image as is. (e.x. `10`, `404`, `0b0000_1111_0000_1111`, `0xff00aa`, `0o7531`)
- if a number is bigger than 24 bits, it is drawn mod 2^24.
- if the word ends with a `:`, then it is a label. anywhere else (including before its definition) in the code where that label is used, it will be replaced with the address of that label.
- if the word *begins* with a `:`, followed by a number, then it tells the compiler to start drawing from that address. this doesnt work for labels because i dont want to figure out how to handle possible loops/self-reference.
- if the word is a mnemonic (see the datasheet), then it is replaced by the number of that instruction or special pointer.
- if the word is a label defined somewhere in the code, it represents the address of that label.

here is a simple example:
```
// single line comment
/* block
comment */
2 0 1 thread1
thread1:
0 ep1
result: 0
ep1:
add im 10 im 20 result
```